package com.ashraf.mushaf;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "AdhkarAlarm")
public class AdhkarAlarmPlugin extends Plugin {
    @PluginMethod
    public void configure(PluginCall call) {
        String kind = call.getString("kind");
        if (!AdhkarAlarmScheduler.isValidKind(kind)) {
            call.reject("kind must be sabah or masaa");
            return;
        }
        Boolean enabledValue = call.getBoolean("enabled", true);
        Integer hourValue = call.getInt("hour");
        Integer minuteValue = call.getInt("minute");
        if (hourValue == null || minuteValue == null || hourValue < 0 || hourValue > 23 || minuteValue < 0 || minuteValue > 59) {
            call.reject("hour and minute must be valid local time values");
            return;
        }
        AdhkarAlarmScheduler.configure(getContext(), kind, Boolean.TRUE.equals(enabledValue), hourValue, minuteValue);
        call.resolve();
    }
}
