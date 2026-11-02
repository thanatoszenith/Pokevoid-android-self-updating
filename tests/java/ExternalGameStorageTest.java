package com.zenni.pokevoid;
import java.io.*;
import java.nio.file.*;
import java.security.*;
import java.util.*;
import java.util.zip.*;

public final class ExternalGameStorageTest {
    static String sha(File f) throws Exception {
        byte[] bytes = MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(f.toPath()));
        StringBuilder s = new StringBuilder(); for (byte b: bytes) s.append(String.format("%02x", b & 255)); return s.toString();
    }
    static File zip(File dir, String name, String... entries) throws Exception {
        File f = new File(dir,name);
        try (ZipOutputStream out = new ZipOutputStream(new FileOutputStream(f))) {
            for (String entry : entries) {
                out.putNextEntry(new ZipEntry(entry)); out.write(name.getBytes("UTF-8")); out.closeEntry();
            }
        }
        return f;
    }
    static void check(boolean condition, String message) { if (!condition) throw new AssertionError(message); }
    static void fails(Work w) throws Exception { try { w.run(); } catch (IOException e) { return; } throw new AssertionError("Expected failure"); }
    interface Work { void run() throws Exception; }
    static void marker(File root, String name, String value) throws Exception { Files.write(new File(root,name).toPath(),value.getBytes("UTF-8")); }
    static ExternalGameStorage oldGame(File root) throws Exception {
        File current = new File(root,"current"); current.mkdirs(); marker(current,"index.html","old"); marker(current,".version","1");
        return new ExternalGameStorage(root);
    }
    public static void main(String[] args) throws Exception {
        File base = Files.createTempDirectory("pokevoid-storage-").toFile();
        try {
            File archive = zip(base,"valid.zip","index.html","assets/main.js");
            File root = new File(base,"game");
            ExternalGameStorage store = oldGame(root);
            fails(() -> store.stage(archive, "0".repeat(64), "2"));
            for (String bad : new String[]{"../escape","/escape","a/../escape","a\\escape"}) {
                File unsafe = zip(base,"unsafe.zip","index.html",bad);
                fails(() -> store.stage(unsafe,sha(unsafe),"2"));
                check(!new File(root,".staging").exists(),"failed extraction cleaned");
                check(store.version().equals("1"),"old game preserved");
            }
            File noIndex = zip(base,"missing.zip","assets/main.js");
            fails(() -> store.stage(noIndex,sha(noIndex),"2"));
            store.stage(archive,sha(archive),"2");
            fails(() -> store.activate("wrong"));
            store.activate(sha(archive));
            check(store.version().equals("2") && store.pending(),"new version testing");
            check(new File(root,".previous/index.html").isFile(),"rollback retained temporarily");
            store.recover(); store.recover();
            check(store.version().equals("1") && !store.pending(),"unconfirmed boot rolled back idempotently");
            store.stage(archive,sha(archive),"2"); store.activate(sha(archive)); store.confirm(); store.recover();
            check(store.version().equals("2"),"confirmed version retained");
            check(Arrays.equals(root.list((d,n)->n.startsWith(".")),new String[]{".failed"}),"no old game or staging after confirmation");
            // Every rename boundary, including a crash during rollback itself.
            for (int phase=0; phase<5; phase++) {
                File r = new File(base,"phase"+phase); ExternalGameStorage x = oldGame(r);
                x.stage(archive,sha(archive),"2"); marker(r,".pending","old");
                if (phase>=1) new File(r,"current").renameTo(new File(r,".previous"));
                if (phase>=2) new File(r,".staging").renameTo(new File(r,"current"));
                if (phase>=3) new File(r,".pending").renameTo(new File(r,".rollback"));
                if (phase>=4) { ExternalGameStorage.removeTree(new File(r,"current")); new File(r,".previous").renameTo(new File(r,"current")); }
                x.recover(); x.recover();
                check(x.version().equals("1"),"crash phase "+phase);
            }
            File firstRoot = new File(base,"first"); ExternalGameStorage first = new ExternalGameStorage(firstRoot);
            first.stage(archive,sha(archive),"2"); first.activate(sha(archive)); first.recover(); first.recover();
            check(!first.installed(),"bad first install removed");
            File committed = new File(base,"committed"); ExternalGameStorage c = oldGame(committed);
            c.stage(archive,sha(archive),"2"); c.activate(sha(archive));
            new File(committed,".pending").renameTo(new File(committed,".confirmed")); c.recover();
            check(c.version().equals("2") && !new File(committed,".previous").exists(),"crash during committed cleanup");
            File cache = new File(base,"cache"); cache.mkdirs();
            File old = new File(cache,"a".repeat(64)+".part"); marker(cache,old.getName(),"old");
            old.setLastModified(System.currentTimeMillis()-DownloadCache.MAX_AGE_MS-1000);
            marker(cache,"b".repeat(64)+".zip","new"); marker(cache,"c".repeat(64)+".part","new"); marker(cache,"user.zip","keep");
            DownloadCache.clean(cache,"c".repeat(64));
            check(cache.list().length==2,"only requested archive and user file retained");
            DownloadCache.clean(cache,"");
            check(cache.list().length==1 && new File(cache,"user.zip").exists(),"successful launch clears owned archives only");
            System.out.println("Installer transaction and cache behavior passed");
        } finally { ExternalGameStorage.removeTree(base); }
    }
}
