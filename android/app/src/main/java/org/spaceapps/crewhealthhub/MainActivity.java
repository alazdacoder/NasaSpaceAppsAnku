package org.spaceapps.crewhealthhub;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.nfc.NdefMessage;
import android.nfc.NdefRecord;
import android.nfc.NfcAdapter;
import android.nfc.Tag;
import android.nfc.tech.Ndef;
import android.os.Bundle;
import android.text.Html;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import com.chaquo.python.PyObject;
import com.chaquo.python.Python;

import org.json.JSONObject;

import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;

/**
 * Space Health Management System (SHMS) on Android. Python (started by PyApplication, see AndroidManifest.xml)
 * runs the same FastAPI server as the desktop app on 127.0.0.1; this activity shows it.
 * Everything runs on the phone - no computer or internet needed.
 *
 * Crew cards: while the app is open, the phone's NFC reader is on (reader mode). A card's
 * NDEF text record (for example "ORBITAL-CREW-01") or, if it has none, its chip UID
 * ("UID:04A1B2C3...") is handed to the page with window.SHMS_onNfcTag(id). The page decides
 * who that is (frontend/src/lib/cards.ts). WebView has no Web NFC, so this bridge is needed.
 */
public class MainActivity extends Activity implements NfcAdapter.ReaderCallback {
    private static final int PORT = 8765;
    private static final String BASE = "http://127.0.0.1:" + PORT + "/";
    private WebView web;
    private NfcAdapter nfc;
    private String lastTag = "";
    private long lastTagAt = 0;

    private static final String PAGE =
        "<html><head><meta name='viewport' content='width=device-width,initial-scale=1'>"
        + "<style>body{background:#F4F7FA;color:#0E2A47;font-family:sans-serif;display:flex;flex-direction:column;"
        + "align-items:center;justify-content:center;height:90vh;text-align:center;padding:24px}"
        + "h1{color:#0E2A47;font-size:24px}p{color:#4A6582;font-size:16px;line-height:1.5}"
        + "pre{white-space:pre-wrap;text-align:left;font-size:12px;color:#C62F45;background:#FFFFFF;padding:12px;"
        + "border-radius:12px;max-width:100%%;overflow:auto}</style></head><body>%s</body></html>";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        web = new WebView(this);
        web.setBackgroundColor(0xFFF4F7FA);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);           // language and crew choice are kept in localStorage
        s.setMediaPlaybackRequiresUserGesture(false);
        nfc = NfcAdapter.getDefaultAdapter(this);
        web.addJavascriptInterface(new NativeBridge(), "SHMSNative");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if ("127.0.0.1".equals(u.getHost())) return false;
                // links to NASA sources (NTRS, OSDR) open in the phone's browser
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) { }
                return true;
            }
        });

        showPage("<h1>&#9678; SHMS</h1><p>Space Health Management System</p>"
                + "<p>Starting the onboard simulator&hellip;<br>The first start can take up to a minute.</p>"
                + "<p>Gemideki sim&uuml;lat&ouml;r ba&#351;lat&#305;l&#305;yor&hellip;<br>"
                + "&#304;lk a&ccedil;&#305;l&#305;&#351; bir dakika kadar s&uuml;rebilir.</p>");
        new Thread(this::startServerAndOpen, "crewhub-start").start();
    }

    private void startServerAndOpen() {
        try {
            PyObject main = Python.getInstance().getModule("android_main");
            main.callAttr("start", PORT);
            for (int i = 0; i < 1800; i++) {          // up to 3 minutes on a slow phone
                if (isUp()) {
                    runOnUiThread(() -> web.loadUrl(BASE));
                    return;
                }
                PyObject err = main.callAttr("error");
                if (err != null) {
                    showError(err.toString());
                    return;
                }
                Thread.sleep(100);
            }
            showError("The simulator did not start in time.");
        } catch (Throwable t) {
            showError(t.toString());
        }
    }

    private boolean isUp() {
        try {
            HttpURLConnection c = (HttpURLConnection) new URL(BASE + "api/health").openConnection();
            c.setConnectTimeout(500);
            c.setReadTimeout(1000);
            int code = c.getResponseCode();
            c.disconnect();
            return code == 200;
        } catch (Exception e) {
            return false;
        }
    }

    private void showError(String msg) {
        runOnUiThread(() -> showPage("<h1>Could not start</h1><p>Please send a screenshot of this screen.</p><pre>"
            + Html.escapeHtml(msg) + "</pre>"));
    }

    private void showPage(String body) {
        web.loadDataWithBaseURL(null, String.format(PAGE, body), "text/html", "utf-8", null);
    }

    // ---- crew cards (NFC) ----------------------------------------------------------------

    /** Called from JavaScript as window.SHMSNative.nfcState(). */
    private class NativeBridge {
        @JavascriptInterface
        public String nfcState() {
            if (nfc == null) return "none";
            return nfc.isEnabled() ? "ready" : "off";
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (nfc != null && nfc.isEnabled()) {
            Bundle opts = new Bundle();
            opts.putInt(NfcAdapter.EXTRA_READER_PRESENCE_CHECK_DELAY, 250);
            nfc.enableReaderMode(this, this,
                NfcAdapter.FLAG_READER_NFC_A | NfcAdapter.FLAG_READER_NFC_B
                    | NfcAdapter.FLAG_READER_NFC_F | NfcAdapter.FLAG_READER_NFC_V,
                opts);
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (nfc != null) {
            try { nfc.disableReaderMode(this); } catch (Exception ignored) { }
        }
    }

    /** Runs on an NFC thread whenever a card is held to the phone. */
    @Override
    public void onTagDiscovered(Tag tag) {
        String id = readCardText(tag);
        if (id == null || id.isEmpty()) id = "UID:" + hex(tag.getId());
        long now = System.currentTimeMillis();
        if (id.equals(lastTag) && now - lastTagAt < 2000) return;   // same card still on the phone
        lastTag = id;
        lastTagAt = now;
        final String js = "window.SHMS_onNfcTag && window.SHMS_onNfcTag(" + JSONObject.quote(id) + ")";
        runOnUiThread(() -> web.evaluateJavascript(js, null));
    }

    /** First NDEF text record on the card, or null. */
    private static String readCardText(Tag tag) {
        Ndef ndef = Ndef.get(tag);
        if (ndef == null) return null;
        try {
            NdefMessage msg = ndef.getCachedNdefMessage();
            if (msg == null) {
                ndef.connect();
                msg = ndef.getNdefMessage();
            }
            if (msg == null) return null;
            for (NdefRecord r : msg.getRecords()) {
                if (r.getTnf() == NdefRecord.TNF_WELL_KNOWN && Arrays.equals(r.getType(), NdefRecord.RTD_TEXT)) {
                    byte[] p = r.getPayload();
                    if (p.length == 0) continue;
                    int langLen = p[0] & 0x3F;
                    boolean utf16 = (p[0] & 0x80) != 0;
                    return new String(p, 1 + langLen, p.length - 1 - langLen,
                        utf16 ? StandardCharsets.UTF_16 : StandardCharsets.UTF_8).trim();
                }
            }
        } catch (Exception ignored) {
            // card moved away or not NDEF-formatted: fall back to the UID
        } finally {
            try { ndef.close(); } catch (Exception ignored) { }
        }
        return null;
    }

    private static String hex(byte[] b) {
        StringBuilder sb = new StringBuilder();
        for (byte x : b) sb.append(String.format("%02X", x));
        return sb.toString();
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) {
            web.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
