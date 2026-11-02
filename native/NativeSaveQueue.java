package com.zenni.pokevoid;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Reads, migrations and writes remain ordered even when Android recreates the Activity. */
public final class NativeSaveQueue {
    private static final ExecutorService writer = Executors.newSingleThreadExecutor(task -> {
        Thread thread = new Thread(task, "pokevoid-save-writer");
        thread.setDaemon(true);
        return thread;
    });
    private NativeSaveQueue() {}
    public static void execute(Runnable task) { writer.execute(task); }
}
