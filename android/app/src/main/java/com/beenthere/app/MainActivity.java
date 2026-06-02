package com.beenthere.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.CapConfig;

public class MainActivity extends BridgeActivity {
    static final String EXTRA_FORCE_REMOTE = "com.beenthere.app.FORCE_REMOTE";
    static final String REMOTE_URL = "https://been-there-maps.vercel.app";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(OfflineHandoffPlugin.class);
        registerPlugin(NativePhotoPickerPlugin.class);

        if (getIntent() != null && getIntent().getBooleanExtra(EXTRA_FORCE_REMOTE, false)) {
            config = new CapConfig.Builder(this)
                .setServerUrl(REMOTE_URL)
                .setAllowNavigation(new String[] { "been-there-maps.vercel.app" })
                .setUseLegacyBridge(true)
                .create();
        }

        super.onCreate(savedInstanceState);
    }
}
