package bot.tab.sites.adihunt;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.GeolocationPermissions;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

/**
 * AdiHunt for Android: a thin WebView shell around the hosted game (same app as the website/PWA). It adds what a browser tab
 * cannot reliably do: asks for the location permission once ("while using the app"), grants it to the game page, keeps the screen
 * awake while the game is in the foreground, and shows a retry page when there is no internet. No background location, no
 * contacts, no storage, no camera.
 */
public class MainActivity extends Activity {
    static final String SERVER = BuildConfig.SERVER;
    static final String START = SERVER + "/app/";
    private WebView web;
    private static final int REQ_LOC = 11;
    private GeolocationPermissions.Callback pendingCb;
    private String pendingOrigin;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#0a0714"));
        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#0a0714"));
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);
        setupWeb();
        if (Build.VERSION.SDK_INT >= 23 && checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_LOC);
        }
        if (state == null || web.restoreState(state) == null) web.loadUrl(deepLink(getIntent()));
    }

    private String deepLink(Intent i) {
        Uri d = i == null ? null : i.getData();
        if (d != null && SERVER.startsWith("http") && d.getHost() != null && SERVER.contains(d.getHost()) && d.getPath() != null && d.getPath().startsWith("/app")) return d.toString();
        return START;
    }

    @Override protected void onNewIntent(Intent i) { super.onNewIntent(i); if (i != null && i.getData() != null) web.loadUrl(deepLink(i)); }
    @Override protected void onSaveInstanceState(Bundle out) { super.onSaveInstanceState(out); web.saveState(out); }
    @Override protected void onResume() { super.onResume(); web.onResume(); web.setKeepScreenOn(true); }
    @Override protected void onPause() { web.setKeepScreenOn(false); web.onPause(); super.onPause(); }
    @Override public void onBackPressed() { if (web.canGoBack()) web.goBack(); else super.onBackPressed(); }

    private void setupWeb() {
        if (BuildConfig.WEB_DEBUG) WebView.setWebContentsDebuggingEnabled(true);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setGeolocationEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setSupportMultipleWindows(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setTextZoom(100);
        s.setUserAgentString(s.getUserAgentString() + " AdiHuntAndroid/" + BuildConfig.VERSION_NAME);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
                Uri u = req.getUrl(); String h = u.getHost() == null ? "" : u.getHost();
                if (SERVER.contains(h) && !h.isEmpty()) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (ActivityNotFoundException e) { /* ignore */ }
                return true;
            }
            @Override public void onReceivedError(WebView v, WebResourceRequest req, WebResourceError err) {
                if (req.isForMainFrame()) {
                    String html = "<html><body style='background:#0a0714;color:#ece6ff;font-family:sans-serif;text-align:center;padding:18vh 24px'>"
                        + "<h2>No connection</h2><p style='color:#9b8fc7'>AdiHunt needs the internet to load the map and shadows.</p>"
                        + "<p><a href='" + START + "' style='display:inline-block;background:#8b5cf6;color:#fff;padding:12px 22px;border-radius:12px;text-decoration:none'>Try again</a></p></body></html>";
                    v.loadDataWithBaseURL(START, html, "text/html", "utf-8", null);
                }
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback cb) {
                boolean granted = Build.VERSION.SDK_INT < 23 || checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
                boolean ours = origin != null && SERVER.startsWith(origin);
                if (granted && ours) { cb.invoke(origin, true, false); return; }
                if (!ours) { cb.invoke(origin, false, false); return; }
                pendingCb = cb; pendingOrigin = origin;
                if (Build.VERSION.SDK_INT >= 23) requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_LOC);
            }
        });
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] res) {
        super.onRequestPermissionsResult(code, perms, res);
        if (code != REQ_LOC) return;
        boolean ok = false; for (int r : res) if (r == PackageManager.PERMISSION_GRANTED) ok = true;
        if (pendingCb != null) { pendingCb.invoke(pendingOrigin, ok, false); pendingCb = null; }
        if (ok) web.reload();
    }
}
