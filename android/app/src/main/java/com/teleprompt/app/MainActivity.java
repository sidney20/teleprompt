package com.teleprompt.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(GallerySavePlugin.class);
        super.onCreate(savedInstanceState);
        handleAuthIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleAuthIntent(intent);
    }

    private void handleAuthIntent(Intent intent) {
        if (intent == null || intent.getData() == null) return;
        Uri uri = intent.getData();
        String fragment = uri.getFragment();
        if (fragment == null || !fragment.contains("access_token")) return;
        String js = "javascript:void(function(){" +
            "var h='" + fragment.replace("'", "\\'") + "';" +
            "var p=new URLSearchParams(h);" +
            "var at=p.get('access_token');" +
            "var rt=p.get('refresh_token');" +
            "if(at&&rt&&window._tpBridge)window._tpBridge.setAuth(at,rt);" +
            "})()";
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().post(new Runnable() {
                @Override
                public void run() {
                    getBridge().getWebView().evaluateJavascript(js, null);
                }
            });
        }
    }
}
