package com.zenni.pokevoid;

import java.net.URI;

/** The browser supplies the requesting frame URL; save commands never trust a JS-provided origin. */
public final class TrustedGameOrigin {
    private TrustedGameOrigin() {}
    public static boolean accepts(String url) {
        try {
            URI uri = new URI(url);
            return "https".equalsIgnoreCase(uri.getScheme()) && "localhost".equalsIgnoreCase(uri.getHost())
                && uri.getRawUserInfo() == null && (uri.getPort() == -1 || uri.getPort() == 443);
        } catch (Exception invalid) { return false; }
    }
}
