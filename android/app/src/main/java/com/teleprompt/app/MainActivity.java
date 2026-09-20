package com.teleprompt.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private String pendingAuth = null;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(GallerySavePlugin.class);
        super.onCreate(savedInstanceState);
        checkAuthIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        checkAuthIntent(intent);
    }

    private void checkAuthIntent(Intent intent) {
        if (intent == null || intent.getData() == null) return;
        Uri uri = intent.getData();
        String fragment = uri.getFragment();
        if (fragment == null || !fragment.contains("access_token")) return;
        pendingAuth = fragment;
        injectAuth();
    }

    private void injectAuth() {
        if (pendingAuth == null) return;
        if (getBridge() == null || getBridge().getWebView() == null) {
            new Handler(Looper.getMainLooper()).postDelayed(this::injectAuth, 500);
            return;
        }
        String frag = pendingAuth;
        pendingAuth = null;
        String js = "javascript:void(function(){" +
            "var h='" + frag.replace("'", "\\'") + "';" +
            "var p=new URLSearchParams(h);" +
            "var at=p.get('access_token');" +
            "var rt=p.get('refresh_token');" +
            "if(at&&rt){" +
              "localStorage.setItem('_tp_pending_auth',JSON.stringify({at:at,rt:rt}));" +
              "if(window._tpBridge)window._tpBridge.setAuth(at,rt);" +
            "}" +
            "})()";
        getBridge().getWebView().post(new Runnable() {
            @Override
            public void run() {
                getBridge().getWebView().evaluateJavascript(js, null);
            }
        });
    }
}
