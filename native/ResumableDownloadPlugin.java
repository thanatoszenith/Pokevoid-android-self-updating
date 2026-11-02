package com.zenni.pokevoid;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.PluginMethod;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "ResumableDownload")
public class ResumableDownloadPlugin extends Plugin {
    private final java.util.concurrent.ExecutorService executor = Executors.newSingleThreadExecutor();
    private volatile ServerSocket server;
    private volatile String serverToken;

    @PluginMethod
    public void download(PluginCall call) {
        String url = call.getString("url"), sha = call.getString("checksum");
        if (url == null || sha == null || !sha.matches("[a-fA-F0-9]{64}")) {
            call.reject("Missing URL or SHA-256"); return;
        }
        executor.execute(() -> {
            try {
                URL source = new URL(url);
                if (!"https".equalsIgnoreCase(source.getProtocol()) || source.getUserInfo() != null || source.getHost().isEmpty()) throw new IOException("Valid HTTPS download URL required");
                File dir = new File(getContext().getFilesDir(), "resumable-bundles");
                if (!dir.exists() && !dir.mkdirs()) throw new IOException("Cannot create download directory");
                String key = sha.toLowerCase(Locale.ROOT);
                File partial = new File(dir, key + ".part"), complete = new File(dir, key + ".zip");
                if (!complete.exists() || !matches(complete, key)) {
                    if (complete.exists()) complete.delete();
                    fetch(source, partial, key);
                    if (!matches(partial, key)) {
                        partial.delete();
                        throw new IOException("Downloaded ZIP checksum mismatch");
                    }
                    if (!partial.renameTo(complete)) throw new IOException("Cannot finalize verified ZIP");
                }
                JSObject result = new JSObject();
                result.put("bytes", complete.length());
                result.put("url", startLocalServer(complete));
                call.resolve(result);
            } catch (Exception error) { call.reject("Resumable download failed", error); }
        });
    }

    @PluginMethod
    public void releaseArchive(PluginCall call) {
        String sha = call.getString("checksum");
        if (sha == null || !sha.matches("[a-fA-F0-9]{64}")) {
            call.reject("Invalid SHA-256"); return;
        }
        executor.execute(() -> {
            try {
                File dir = new File(getContext().getFilesDir(), "resumable-bundles");
                File archive = new File(dir, sha.toLowerCase(Locale.ROOT) + ".zip");
                synchronized (this) {
                    if (server != null) { server.close(); server = null; }
                    serverToken = null;
                }
                if (archive.exists() && !archive.delete()) throw new IOException("Could not remove imported archive");
                call.resolve();
            } catch (Exception error) { call.reject("Archive cleanup failed", error); }
        });
    }

    private void fetch(URL url, File partial, String checksum) throws Exception {
        long offset = partial.exists() ? partial.length() : 0;
        if (offset > 0 && matches(partial, checksum)) return;
        IOException lastFailure = null;
        for (int attempt = 0; attempt < 5; attempt++) {
            HttpURLConnection c = null;
            try {
                c = (HttpURLConnection) url.openConnection();
                c.setConnectTimeout(20000);
                c.setReadTimeout(30000);
                c.setInstanceFollowRedirects(true);
                c.setRequestProperty("Accept-Encoding", "identity");
                if (offset > 0) c.setRequestProperty("Range", "bytes=" + offset + "-");
                int code = c.getResponseCode();
                if (!"https".equalsIgnoreCase(c.getURL().getProtocol())) throw new IOException("Non-HTTPS redirect refused");
                if (code == 416 && offset > 0) {
                    if (matches(partial, checksum)) return;
                    if (!partial.delete()) throw new IOException("Cannot reset invalid partial download");
                    offset = 0;
                    continue;
                }
                if (code != 200 && code != 206) throw new IOException("HTTP " + code);
                if (offset == 0 && code == 206) throw new IOException("Unexpected partial response");
                long total = c.getContentLengthLong();
                if (offset > 0 && code == 206) {
                    String range = c.getHeaderField("Content-Range");
                    if (range == null || !range.matches("bytes " + offset + "-[0-9]+/[0-9]+")) {
                        throw new IOException("Invalid Content-Range for resumed download");
                    }
                    String[] bounds = range.substring(6).split("[-/]");
                    long end = Long.parseLong(bounds[1]);
                    long declaredTotal = Long.parseLong(bounds[2]);
                    if (end < offset || declaredTotal <= end || end != declaredTotal - 1) {
                        throw new IOException("Incomplete or invalid resumed range");
                    }
                    if (total >= 0 && total != end - offset + 1) throw new IOException("Inconsistent Content-Range and Content-Length");
                    total = declaredTotal;
                } else if (offset > 0) {
                    // The server ignored Range: restart from byte zero.
                    offset = 0;
                }
                if (c.getContentEncoding() != null && !"identity".equalsIgnoreCase(c.getContentEncoding())) {
                    throw new IOException("Encoded download response refused");
                }
                long done = offset;
                long lastEvent = 0;
                try (InputStream input = c.getInputStream();
                     FileOutputStream output = new FileOutputStream(partial, offset > 0)) {
                    byte[] buf = new byte[65536];
                    int n;
                    while ((n = input.read(buf)) != -1) {
                        if (total >= 0 && (long)n > total - done) throw new IOException("Response exceeded advertised size");
                        output.write(buf, 0, n);
                        done += n;
                        long now = System.currentTimeMillis();
                        if (now - lastEvent >= 300) {
                            JSObject event = new JSObject();
                            event.put("downloaded", done);
                            event.put("total", total);
                            notifyListeners("progress", event);
                            lastEvent = now;
                        }
                    }
                    output.getFD().sync();
                }
                offset = done;
                JSObject event = new JSObject();
                event.put("downloaded", done);
                event.put("total", total);
                notifyListeners("progress", event);
                if (total >= 0 && done != total) throw new IOException("Incomplete HTTP response");
                return;
            } catch (IOException error) {
                lastFailure = error;
                offset = partial.exists() ? partial.length() : 0;
                if (offset > 0 && matches(partial, checksum)) return;
                if (attempt < 4) {
                    try { Thread.sleep(Math.min(500L * (1L << attempt), 4000L)); }
                    catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); throw new IOException("Download interrupted", interrupted); }
                }
            } finally {
                if (c != null) c.disconnect();
            }
        }
        throw new IOException("Download interrupted after retries; partial data preserved", lastFailure);
    }

    private boolean matches(File file, String checksum) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new FileInputStream(file)) {
            byte[] b = new byte[65536]; int n;
            while ((n = in.read(b)) != -1) md.update(b, 0, n);
        }
        StringBuilder hex = new StringBuilder();
        for (byte b : md.digest()) hex.append(String.format(Locale.ROOT, "%02x", b & 0xff));
        return hex.toString().equals(checksum);
    }

    private synchronized String startLocalServer(File file) throws IOException {
        if (server != null && !server.isClosed()) server.close();
        server = new ServerSocket(0, 4, InetAddress.getByName("127.0.0.1"));
        serverToken = java.util.UUID.randomUUID().toString();
        String token = serverToken;
        ServerSocket socket = server;
        Thread thread = new Thread(() -> {
            while (!socket.isClosed()) {
                try {
                    Socket client = socket.accept();
                    executorForClient(client, file, token);
                } catch (IOException e) { break; }
            }
        }, "pokevoid-archive-server");
        thread.setDaemon(true); thread.start();
        return "http://127.0.0.1:" + socket.getLocalPort() + "/" + token + "/bundle.zip";
    }

    private void executorForClient(Socket client, File file, String token) {
        new Thread(() -> {
            try (Socket s = client; BufferedReader reader = new BufferedReader(new InputStreamReader(s.getInputStream(), StandardCharsets.US_ASCII))) {
                s.setSoTimeout(30000);
                String request = reader.readLine();
                if (request == null || request.length() > 8192 || !(request.equals("GET /" + token + "/bundle.zip HTTP/1.1") || request.equals("HEAD /" + token + "/bundle.zip HTTP/1.1"))) return;
                String line, range = null;
                int headerCount = 0;
                while ((line = reader.readLine()) != null && !line.isEmpty()) {
                    if (++headerCount > 64 || line.length() > 8192) return;
                    if (line.toLowerCase(Locale.ROOT).startsWith("range:")) range = line.substring(6).trim();
                }
                long start = 0, end = file.length() - 1;
                if (range != null && range.matches("bytes=\\d+-\\d*")) {
                    try {
                        String[] pieces = range.substring(6).split("-", 2);
                        start = Long.parseLong(pieces[0]);
                        if (pieces.length > 1 && !pieces[1].isEmpty()) end = Math.min(end, Long.parseLong(pieces[1]));
                    } catch (NumberFormatException invalidRange) { start = file.length(); }
                }
                if (range != null && !range.matches("bytes=\\d+-\\d*")) return;
                if (start > end || start >= file.length() || file.length() == 0) {
                    OutputStream out = s.getOutputStream();
                    out.write(("HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */" + file.length() + "\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
                    out.flush(); return;
                }
                boolean partial = start > 0 || end < file.length() - 1;
                OutputStream out = s.getOutputStream();
                String headers = "HTTP/1.1 " + (partial ? "206 Partial Content" : "200 OK") + "\r\nContent-Type: application/zip\r\nAccept-Ranges: bytes\r\nContent-Length: " + (end-start+1) + "\r\n" + (partial ? "Content-Range: bytes " + start + "-" + end + "/" + file.length() + "\r\n" : "") + "Connection: close\r\n\r\n";
                out.write(headers.getBytes(StandardCharsets.US_ASCII));
                if (!request.startsWith("HEAD")) {
                    try (RandomAccessFile input = new RandomAccessFile(file, "r")) {
                        input.seek(start); byte[] b = new byte[65536]; long left = end-start+1;
                        while (left > 0) { int n = input.read(b, 0, (int)Math.min(left,b.length)); if(n < 0) break; out.write(b,0,n); left-=n; }
                    }
                }
                out.flush();
            } catch (Exception ignored) {}
        }, "pokevoid-archive-client").start();
    }
}
