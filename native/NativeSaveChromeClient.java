package com.zenni.pokevoid;

import android.os.Handler;
import android.os.Looper;
import java.util.concurrent.*;
import android.webkit.JsPromptResult;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebChromeClient;
import org.json.JSONObject;

/** Install during Activity.onCreate, before ActivityResult registration closes. */
public final class NativeSaveChromeClient extends BridgeWebChromeClient {
    private final Handler ui = new Handler(Looper.getMainLooper());
    private volatile boolean closed;
    private final DirectSaveBridge saves = new DirectSaveBridge();
    public NativeSaveChromeClient(Bridge bridge) { super(bridge); }

    @Override public boolean onJsPrompt(WebView view, String url, String message, String payload, JsPromptResult result) {
        if (!"PokeVoidSaves/v1".equals(message)) return super.onJsPrompt(view, url, message, payload, result);
        if (!TrustedGameOrigin.accepts(url)) { result.confirm("Untrusted save origin"); return true; }
        if (closed) { result.cancel(); return true; }
        try {
            NativeSaveQueue.execute(() -> {
                String error = command(payload);
                ui.post(() -> { if (closed) result.cancel(); else result.confirm(error); });
            });
        } catch (RejectedExecutionException stopped) { result.cancel(); }
        return true;
    }

    public void close() { closed = true; }

    private String command(String payload) {
        String error;
        try {
            if (payload == null || payload.length() > 32 * 1024 * 1024) throw new IllegalArgumentException("Save command exceeds limit");
            JSONObject command = new JSONObject(payload);
            String operation = command.getString("operation");
            if ("status".equals(operation)) error = saves.status();
            else {
                Object key = command.get("key");
                if (!(key instanceof String)) throw new IllegalArgumentException("Invalid save key");
                if ("write".equals(operation)) {
                    Object value = command.get("value");
                    if (!(value instanceof String)) throw new IllegalArgumentException("Invalid save value");
                    error = saves.write((String) key, (String) value);
                } else if ("remove".equals(operation)) error = saves.remove((String) key);
                else throw new IllegalArgumentException("Unknown save operation");
            }
        } catch (Exception failure) {
            error = failure.getMessage() == null ? "External save failed" : failure.getMessage();
        }
        return error;
    }
}
