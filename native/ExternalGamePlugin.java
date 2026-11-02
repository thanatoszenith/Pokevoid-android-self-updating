package com.zenni.pokevoid;

import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.webkit.*;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.*;
import java.util.concurrent.*;

/** Uses Capacitor's WebView file host at the stable https://localhost origin. No private asset copy. */
@CapacitorPlugin(name = "ExternalGame")
public class ExternalGamePlugin extends Plugin {
    private static final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final Handler ui = new Handler(Looper.getMainLooper());
    private volatile boolean destroyed;
    private volatile boolean launched;
    private volatile File activeBase;
    private volatile boolean loadFailed;
    private volatile boolean waiting;
    private volatile String launchId = "";
    private final Runnable timeout = () -> { if (waiting) rollback(); };
    private ExternalGameStorage storage() throws IOException {
        if (Build.VERSION.SDK_INT < 30 || !Environment.isExternalStorageManager())
            throw new IOException("Enable All files access to use PokeVoid/Game");
        return new ExternalGameStorage(new File(Environment.getExternalStorageDirectory(), "PokeVoid/Game"));
    }
    private void onUi(Runnable action) {
        ui.post(() -> { if (!destroyed) action.run(); });
    }
    interface Action { void run() throws Exception; }
    private void execute(PluginCall call, Action action) {
        try {
            worker.execute(() -> {
                try { if (destroyed) throw new IOException("Activity is closing"); action.run(); } catch (Exception e) { call.reject(e.getMessage(), e); }
            });
        } catch (RejectedExecutionException stopped) { call.reject("Activity is closing", stopped); }
    }
    @Override public void load() {
        getBridge().injectScriptBeforeLoad("save-compat.js");
        onUi(() -> {
            getBridge().getWebView().getSettings().setCacheMode(WebSettings.LOAD_NO_CACHE);
            getBridge().setWebViewClient(new BridgeWebViewClient(getBridge()) {
                @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                    if (launched && "localhost".equals(request.getUrl().getHost())) {
                        try {
                            String path = request.getUrl().getPath();
                            File base = activeBase;
                            File target = new File(base, path.startsWith("/") ? path.substring(1) : path).getCanonicalFile();
                            if (path.startsWith("/_capacitor_file_") || path.startsWith("/_capacitor_content_")
                                || !(target.equals(base) || target.getPath().startsWith(base.getPath() + File.separator)))
                                throw new IOException("Path outside game directory");
                        } catch (Exception e) {
                            return new WebResourceResponse("text/plain", "UTF-8", 403, "Forbidden", java.util.Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
                        }
                    }
                    return super.shouldInterceptRequest(view, request);
                }
                @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                    super.onReceivedError(view, request, error);
                    if (launched && request.isForMainFrame()) rollback();
                }
                @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                    super.onReceivedHttpError(view, request, response);
                    if (launched && request.isForMainFrame()) rollback();
                }
            });
        });
    }
    private JSObject state() throws Exception {
        ExternalGameStorage s = storage();
        JSObject result = new JSObject();
        result.put("installed", s.installed()); result.put("version", s.version());
        result.put("path", s.current().getAbsolutePath()); result.put("launchId", launchId);
        result.put("pending", s.pending()); result.put("failedChecksum", s.failedChecksum()); result.put("loadFailed", loadFailed);
        return result;
    }
    @PluginMethod public void status(PluginCall call) { execute(call, () -> call.resolve(state())); }
    @PluginMethod public void recover(PluginCall call) {
        execute(call, () -> {
            if (launched) throw new IOException("Cannot recover a running game");
            storage().recover(); DownloadCache.clean(new File(getContext().getFilesDir(), "resumable-bundles"), null);
            call.resolve(state());
        });
    }
    @PluginMethod public void stage(PluginCall call) {
        execute(call, () -> {
            String sha = call.getString("checksum");
            if (sha == null || !sha.matches("[a-fA-F0-9]{64}")) throw new IOException("Invalid checksum");
            File archive = new File(new File(getContext().getFilesDir(), "resumable-bundles"), sha.toLowerCase(java.util.Locale.ROOT) + ".zip");
            try (DownloadCache.Lease lease = DownloadCache.hold(archive)) {
                storage().stage(archive, sha, call.getString("version"));
            }
            call.resolve();
        });
    }
    @PluginMethod public void activate(PluginCall call) {
        execute(call, () -> {
            storage().activate(call.getString("checksum")); call.resolve();
        });
    }
    @PluginMethod public void open(PluginCall call) {
        execute(call, () -> {
            ExternalGameStorage s = storage();
            if (!s.installed()) throw new IOException("No external game installed");
            File base = s.current().getCanonicalFile();
            waiting = true;
            launchId = java.util.UUID.randomUUID().toString();
            onUi(() -> {
                getBridge().getWebView().stopLoading();
                getBridge().getWebView().clearCache(true);
                ui.removeCallbacks(timeout);
                activeBase = base; launched = true; loadFailed = false;
                getBridge().setServerBasePath(base.getPath());
                if (waiting) ui.postDelayed(timeout, 180000);
            });
            call.resolve();
        });
    }
    @PluginMethod public void abortLaunch(PluginCall call) {
        launched = false; waiting = false; ui.removeCallbacks(timeout);
        onUi(() -> {
            getBridge().getWebView().stopLoading();
            execute(call, () -> {
                storage().recover();
                onUi(() -> { getBridge().getWebView().clearCache(true); getBridge().setServerAssetPath("public"); });
                call.resolve();
            });
        });
    }
    @PluginMethod public void confirmLaunch(PluginCall call) {
        execute(call, () -> {
            if (!launched || !launchId.equals(call.getString("launchId"))) throw new IOException("Stale launch confirmation");
            storage().confirm(); waiting = false; ui.removeCallbacks(timeout);
            DownloadCache.clean(new File(getContext().getFilesDir(), "resumable-bundles"), "");
            cleanLegacyAssets();
            call.resolve();
        });
    }
    private void cleanLegacyAssets() throws IOException {
        // Exact directories owned by the retired updater; never WebView data or saves.
        ExternalGameStorage.removeTree(new File(getContext().getFilesDir(), "versions"));
        ExternalGameStorage.removeTree(new File(getContext().getCacheDir(), "capgo_downloads"));
        File root = storage().current().getParentFile();
        File[] leftovers = root.listFiles((dir, name) -> name.matches("(\\.staging-[a-f0-9]{64}|pokevoid-[a-f0-9]{64}\\.zip)"));
        if (leftovers != null) for (File item : leftovers) ExternalGameStorage.removeTree(item);
        File releases = new File(root, "releases");
        File[] versions = releases.listFiles((dir, name) -> name.matches("[a-f0-9]{64}"));
        if (versions != null) for (File item : versions) ExternalGameStorage.removeTree(item);
    }
    private void rollback() {
        if (!launched) return;
        launched = false; loadFailed = true; waiting = false; ui.removeCallbacks(timeout);
        onUi(() -> {
            getBridge().getWebView().stopLoading();
            worker.execute(() -> {
                try { storage().recover(); } catch (Exception e) { android.util.Log.e("PokeVoid", "Recovery failed", e); }
                onUi(() -> { getBridge().getWebView().clearCache(true); getBridge().setServerAssetPath("public"); });
            });
        });
    }
    @Override protected void handleOnPause() { ui.removeCallbacks(timeout); }
    @Override protected void handleOnResume() { if (waiting) ui.postDelayed(timeout, 180000); }
    @Override protected void handleOnDestroy() { destroyed = true; ui.removeCallbacksAndMessages(null); }
}
