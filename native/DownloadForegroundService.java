package com.zenni.pokevoid;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import androidx.core.app.NotificationCompat;

public class DownloadForegroundService extends Service {
    private static final String CHANNEL = "pokevoid_download";
    private static final int NOTIFICATION_ID = 4207;

    @Override public void onCreate() {
        super.onCreate();
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        manager.createNotificationChannel(new NotificationChannel(CHANNEL, "PokéVoid downloads", NotificationManager.IMPORTANCE_LOW));
        Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent pending = launch == null ? null : PendingIntent.getActivity(this, 0, launch,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL)
                .setSmallIcon(android.R.drawable.stat_sys_download)
                .setContentTitle("Downloading PokéVoid")
                .setContentText("Download continues while the app is in the background")
                .setOngoing(true).setOnlyAlertOnce(true).setProgress(0, 0, true);
        if (pending != null) builder.setContentIntent(pending);
        Notification notification = builder.build();
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIFICATION_ID, notification, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        return START_NOT_STICKY;
    }

    @Override public IBinder onBind(Intent intent) { return null; }
}
