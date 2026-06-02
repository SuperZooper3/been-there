package com.beenthere.app;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "OfflineHandoff")
public class OfflineHandoffPlugin extends Plugin {
    private static final String PREFS_NAME = "BeenThereOfflineHandoff";
    private static final String PAYLOAD_KEY = "pendingPayload";

    @PluginMethod
    public void openRemoteApp(PluginCall call) {
        String payload = call.getString("payload", "{}");
        SharedPreferences prefs = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().putString(PAYLOAD_KEY, payload).apply();

        Intent intent = new Intent(getActivity(), MainActivity.class);
        intent.putExtra(MainActivity.EXTRA_FORCE_REMOTE, true);
        intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TASK | Intent.FLAG_ACTIVITY_NEW_TASK);
        getActivity().startActivity(intent);

        call.resolve();
    }

    @PluginMethod
    public void getPendingPayload(PluginCall call) {
        SharedPreferences prefs = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String payload = prefs.getString(PAYLOAD_KEY, null);
        if (payload != null) {
            prefs.edit().remove(PAYLOAD_KEY).apply();
        }

        JSObject result = new JSObject();
        result.put("payload", payload);
        call.resolve(result);
    }
}
