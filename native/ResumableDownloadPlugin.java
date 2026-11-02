package com.zenni.pokevoid;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.PluginMethod;
import java.io.*;
import android.content.Intent;
import androidx.core.content.ContextCompat;
import java.net.*;
import java.util.Locale;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.atomic.AtomicInteger;

@CapacitorPlugin(name = "ResumableDownload")
public class ResumableDownloadPlugin extends Plugin {
    private static final java.util.concurrent.ExecutorService executor = Executors.newSingleThreadExecutor();
    private static final AtomicInteger activeDownloads = new AtomicInteger();

    @PluginMethod
    public void download(PluginCall call) {
        String url = call.getString("url"), sha = call.getString("checksum");
        if (url == null || sha == null || !sha.matches("[a-fA-F0-9]{64}")) {
            call.reject("Missing URL or SHA-256"); return;
        }
        try {
            ContextCompat.startForegroundService(getContext(), new Intent(getContext(), DownloadForegroundService.class));
        } catch (Exception error) {
            call.reject("Unable to start background download service", error);
            return;
        }
        activeDownloads.incrementAndGet();
        try { executor.execute(() -> {
            try {
                URL source = new URL(url);
                if (!"https".equalsIgnoreCase(source.getProtocol()) || source.getUserInfo() != null || source.getHost().isEmpty()) throw new IOException("Valid HTTPS download URL required");
                File dir = ExternalGamePaths.downloads();
                if (!dir.exists() && !dir.mkdirs()) throw new IOException("Cannot create download directory");
                String key = sha.toLowerCase(Locale.ROOT);
                File partial = new File(dir, key + ".part"), complete = new File(dir, key + ".zip");
                DownloadCache.clean(dir, key);
                try (DownloadCache.Lease partialLease = DownloadCache.hold(partial);
                     DownloadCache.Lease completeLease = DownloadCache.hold(complete)) {
                    boolean verifiedComplete = complete.exists() && matches(complete, key);
                    if (verifiedComplete) sendProgress(complete.length(), complete.length());
                    if (verifiedComplete && partial.exists() && !partial.delete()) throw new IOException("Cannot remove redundant partial archive");
                    if (!verifiedComplete) {
                        if (complete.exists() && !complete.delete()) throw new IOException("Cannot replace corrupt cached archive");
                        if (!fetch(source, partial, key) && !matches(partial, key)) {
                            partial.delete();
                            throw new IOException("Downloaded ZIP checksum mismatch");
                        }
                        if (!partial.renameTo(complete)) throw new IOException("Cannot finalize verified ZIP");
                    }
                    // Do not duplicate the large archive in shared storage. The external
                    // installer will extract verified assets directly into PokeVoid/Game.
                    JSObject result = new JSObject();
                    result.put("bytes", complete.length());
                    result.put("checksum", key);
                    call.resolve(result);
                }
            } catch (Exception error) { call.reject("Resumable download failed", error); }
            finally {
                if (activeDownloads.decrementAndGet() == 0)
                    getContext().stopService(new Intent(getContext(), DownloadForegroundService.class));
            }
        }); } catch (RejectedExecutionException error) {
            if (activeDownloads.decrementAndGet() == 0) getContext().stopService(new Intent(getContext(), DownloadForegroundService.class));
            call.reject("Download queue unavailable", error);
        }
    }

    @PluginMethod
    public void releaseArchive(PluginCall call) {
        String sha = call.getString("checksum");
        if (sha == null || !sha.matches("[a-fA-F0-9]{64}")) {
            call.reject("Invalid SHA-256"); return;
        }
        executor.execute(() -> {
            try {
                File dir = ExternalGamePaths.downloads();
                if (!DownloadCache.release(dir, sha)) throw new IOException("Archive is still in use");
                call.resolve();
            } catch (Exception error) { call.reject("Archive cleanup failed", error); }
        });
    }

    private HttpURLConnection openVerifiedConnection(URL source, long offset) throws IOException {
        URL target = source;
        for (int hop = 0; hop <= 8; hop++) {
            if (!"https".equalsIgnoreCase(target.getProtocol()) || target.getUserInfo() != null
                    || target.getHost() == null || target.getHost().isEmpty()) {
                throw new IOException("Unsafe download redirect refused");
            }
            HttpURLConnection connection = (HttpURLConnection) target.openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setUseCaches(false);
            connection.setConnectTimeout(20000);
            connection.setReadTimeout(30000);
            connection.setRequestProperty("Accept-Encoding", "identity");
            if (offset > 0) connection.setRequestProperty("Range", "bytes=" + offset + "-");
            boolean returned = false;
            try {
                int status = connection.getResponseCode();
                if (status == 301 || status == 302 || status == 303 || status == 307 || status == 308) {
                    String location = connection.getHeaderField("Location");
                    if (location == null || location.isEmpty()) throw new IOException("Redirect missing Location");
                    URL next = new URL(target, location);
                    if (!"https".equalsIgnoreCase(next.getProtocol()) || next.getUserInfo() != null) {
                        throw new IOException("Non-HTTPS or credential-bearing redirect refused");
                    }
                    target = next;
                } else {
                    returned = true;
                    return connection;
                }
            } finally {
                if (!returned) connection.disconnect();
            }
        }
        throw new IOException("Too many download redirects");
    }

    private boolean fetch(URL url, File partial, String checksum) throws Exception {
        long offset = partial.exists() ? partial.length() : 0;
        if (offset > 0 && matches(partial, checksum)) {
            sendProgress(offset, offset);
            return true;
        }
        // Report resumed bytes before the next network read, so the UI never starts at zero.
        sendProgress(offset, -1);
        long expectedTotal = -1;
        IOException lastFailure = null;
        int successfulSegments = 0;
        boolean rangeReset = false;
        for (int attempt = 0; attempt < 5; attempt++) {
            HttpURLConnection c = null;
            try {
                // openVerifiedConnection already connected and applied these headers
                // to every redirect hop. Mutating request headers now throws IllegalStateException.
                c = openVerifiedConnection(url, offset);
                int code = c.getResponseCode();

                if (code == 416 && offset > 0) {
                    if (matches(partial, checksum)) return true;
                    if (rangeReset) throw new IOException("Server repeatedly rejected resume range");
                    rangeReset = true;
                    if (!partial.delete()) throw new IOException("Cannot reset invalid partial download");
                    offset = 0;
                    attempt--;
                    continue;
                }
                if (code != 200 && code != 206) throw new IOException("HTTP " + code);
                if (offset == 0 && code == 206) throw new IOException("Unexpected partial response");
                long total = c.getContentLengthLong();
                if (total > DownloadCache.MAX_BYTES) throw new IOException("Archive exceeds download limit");
                long responseEnd = -1;
                if (offset > 0 && code == 206) {
                    String range = c.getHeaderField("Content-Range");
                    if (range == null || !range.matches("bytes " + offset + "-[0-9]+/[0-9]+")) {
                        throw new IOException("Invalid Content-Range for resumed download");
                    }
                    String[] bounds = range.substring(6).split("[-/]");
                    long end = Long.parseLong(bounds[1]);
                    long declaredTotal = Long.parseLong(bounds[2]);
                    if (end < offset || declaredTotal <= end) {
                        throw new IOException("Incomplete or invalid resumed range");
                    }
                    if (total >= 0 && total != end - offset + 1) throw new IOException("Inconsistent Content-Range and Content-Length");
                    responseEnd = end;
                    total = declaredTotal;
                } else if (offset > 0) {
                    // The server ignored Range: restart from byte zero.
                    offset = 0;
                }
                if (total > DownloadCache.MAX_BYTES) throw new IOException("Archive exceeds download limit");
                expectedTotal = total;
                if (c.getContentEncoding() != null && !"identity".equalsIgnoreCase(c.getContentEncoding())) {
                    throw new IOException("Encoded download response refused");
                }
                long done = offset;
                sendProgress(done, total);
                long lastEvent = System.currentTimeMillis();
                try (InputStream input = c.getInputStream();
                     FileOutputStream output = new FileOutputStream(partial, offset > 0)) {
                    byte[] buf = new byte[65536];
                    int n;
                    while ((n = input.read(buf)) != -1) {
                        if ((long)n > DownloadCache.MAX_BYTES - done) throw new IOException("Archive exceeds download limit");
                        if (total >= 0 && (long)n > total - done) throw new IOException("Response exceeded advertised size");
                        if (responseEnd >= 0 && (long)n > responseEnd + 1 - done) throw new IOException("Response exceeded declared Content-Range");
                        output.write(buf, 0, n);
                        done += n;
                        long now = System.currentTimeMillis();
                        if (now - lastEvent >= 300) {
                            sendProgress(done, total);
                            lastEvent = now;
                        }
                    }
                    output.getFD().sync();
                }
                offset = done;
                sendProgress(done, total);
                if (responseEnd >= 0 && done != responseEnd + 1) throw new IOException("Incomplete resumed range response");
                if (total >= 0 && done != total) {
                    if (code == 200) throw new IOException("Incomplete full HTTP response");
                    // A server may send a valid bounded range instead of the entire remaining suffix.
                    // Request the next range rather than treating a valid segment as a failure.
                    offset = done;
                    if (++successfulSegments > 8192) throw new IOException("Too many bounded range responses");
                    // Bounded partial responses are progress, not failed attempts.
                    attempt--;
                    continue;
                }
                return false;
            } catch (IOException error) {
                lastFailure = error;
                offset = partial.exists() ? partial.length() : 0;
                if (DownloadCache.mayBeComplete(offset, expectedTotal) && matches(partial, checksum)) return true;
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

    private void sendProgress(long downloaded, long total) {
        JSObject event = new JSObject();
        event.put("downloaded", downloaded);
        event.put("total", total);
        notifyListeners("progress", event);
        try { DownloadForegroundService.updateProgress(getContext(), downloaded, total); }
        catch (RuntimeException error) { android.util.Log.w("PokeVoid", "Notification progress unavailable", error); }
    }

    private boolean matches(File file, String checksum) throws Exception {
        return ExternalGameStorage.matches(file, checksum);
    }

    // Process-wide serial queue survives Activity recreation; no Activity is retained when idle.
}
