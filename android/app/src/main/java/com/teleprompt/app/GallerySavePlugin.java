package com.teleprompt.app;

import android.content.ContentValues;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.OutputStream;

@CapacitorPlugin(name = "GallerySave")
public class GallerySavePlugin extends Plugin {

    @PluginMethod
    public void saveVideo(PluginCall call) {
        String data = call.getString("data");
        String filename = call.getString("filename");
        String mimeType = call.getString("mimeType", "video/mp4");

        if (data == null || filename == null) {
            call.reject("Missing data or filename");
            return;
        }

        try {
            byte[] bytes = Base64.decode(data, Base64.DEFAULT);

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                saveWithMediaStore(bytes, filename, mimeType, call);
            } else {
                saveLegacy(bytes, filename, mimeType, call);
            }
        } catch (Exception e) {
            call.reject("Save failed: " + e.getMessage(), e);
        }
    }

    private void saveWithMediaStore(byte[] bytes, String filename, String mimeType, PluginCall call) throws IOException {
        ContentValues values = new ContentValues();
        values.put(MediaStore.Video.Media.DISPLAY_NAME, filename);
        values.put(MediaStore.Video.Media.MIME_TYPE, mimeType);
        values.put(MediaStore.Video.Media.RELATIVE_PATH, Environment.DIRECTORY_DCIM + "/TelePrompt");

        android.net.Uri uri = getActivity().getContentResolver()
                .insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, values);

        if (uri == null) {
            call.reject("Failed to create MediaStore entry");
            return;
        }

        try (OutputStream os = getActivity().getContentResolver().openOutputStream(uri)) {
            if (os == null) {
                call.reject("Failed to open output stream");
                return;
            }
            os.write(bytes);
        }

        JSObject result = new JSObject();
        result.put("uri", uri.toString());
        call.resolve(result);
    }

    private void saveLegacy(byte[] bytes, String filename, String mimeType, PluginCall call) throws IOException {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            if (getContext().checkSelfPermission(android.Manifest.permission.WRITE_EXTERNAL_STORAGE)
                    != PackageManager.PERMISSION_GRANTED) {
                call.reject("WRITE_EXTERNAL_STORAGE permission not granted");
                return;
            }
        }

        File dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DCIM);
        File telepromptDir = new File(dir, "TelePrompt");
        if (!telepromptDir.exists()) {
            telepromptDir.mkdirs();
        }

        File file = new File(telepromptDir, filename);
        try (java.io.FileOutputStream fos = new java.io.FileOutputStream(file)) {
            fos.write(bytes);
        }

        ContentValues values = new ContentValues();
        values.put(MediaStore.Video.Media.DATA, file.getAbsolutePath());
        values.put(MediaStore.Video.Media.MIME_TYPE, mimeType);
        getActivity().getContentResolver().insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, values);

        JSObject result = new JSObject();
        result.put("uri", file.toURI().toString());
        call.resolve(result);
    }
}
