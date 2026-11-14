package org.spaceapps.crewhealthhub;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.text.Html;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import com.chaquo.python.PyObject;
import com.chaquo.python.Python;

import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Space Health Management System (SHMS) on Android. Python (started by PyApplication, see AndroidManifest.xml)
 * runs the same FastAPI server as the desktop app on 127.0.0.1; this activity shows it.
 * Everything runs on the phone - no computer or internet needed.
 */
public class MainActivity extends Activity {
    private static final int PORT = 8765;
    private static final String BASE = "http://127.0.0.1:" + PORT + "/";
    private WebView web;

    private static final String PAGE =
        "<html><head><meta name='viewport' content='width=device-width,initial-scale=1'>"
        + "<style>body{background:#0B0D12;color:#e2e8f0;font-family:sans-serif;display:flex;flex-direction:column;"
        + "align-items:center;justify-content:center;height:90vh;text-align:center;padding:24px}"
        + "h1{color:#4CC9F0;font-size:24px}p{color:#94a3b8;font-size:16px;line-height:1.5}"
        + "pre{white-space:pre-wrap;text-align:left;font-size:12px;color:#fda4af;background:#1E222D;padding:12px;"
        + "border-radius:12px;max-width:100%%;overflow:auto}</style></head><body>%s</body></html>";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        web = new WebView(this);
        web.setBackgroundColor(0xFF0B0D12);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);           // language and crew choice are kept in localStorage
        s.setMediaPlaybackRequiresUserGesture(false);
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

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) {
            web.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
