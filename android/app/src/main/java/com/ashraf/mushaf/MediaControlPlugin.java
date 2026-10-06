package com.ashraf.mushaf;

import android.content.Intent;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "MediaControl")
public class MediaControlPlugin extends Plugin {

    @Override
    public void load() {
        MediaPlaybackService.setPlugin(this);
    }

    @PluginMethod
    public void updateNowPlaying(PluginCall call) {
        String title = call.getString("title", "المصحف الأشرف");
        String subtitle = call.getString("subtitle", "");
        String speed = call.getString("speed", "1×");
        boolean isPlaying = Boolean.TRUE.equals(call.getBoolean("isPlaying", false));

        Intent intent = new Intent(getContext(), MediaPlaybackService.class);
        intent.putExtra("title", title);
        intent.putExtra("subtitle", subtitle);
        intent.putExtra("speed", speed);
        intent.putExtra("isPlaying", isPlaying);
        getContext().startForegroundService(intent);
        call.resolve();
    }

    @PluginMethod
    public void stopNowPlaying(PluginCall call) {
        Intent intent = new Intent(getContext(), MediaPlaybackService.class);
        intent.setAction(MediaPlaybackService.ACTION_STOP);
        getContext().startService(intent);
        call.resolve();
    }

    public void sendMediaEvent(String action) {
        JSObject data = new JSObject();
        data.put("action", action);
        notifyListeners("mediaControl", data);
    }
}
