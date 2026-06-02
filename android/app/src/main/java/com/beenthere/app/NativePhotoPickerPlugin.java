package com.beenthere.app;

import android.Manifest;
import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.DocumentsContract;
import android.provider.MediaStore;
import android.provider.OpenableColumns;

import androidx.activity.result.ActivityResult;
import androidx.exifinterface.media.ExifInterface;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@CapacitorPlugin(
    name = "NativePhotoPicker",
    permissions = {
        @Permission(strings = { Manifest.permission.ACCESS_MEDIA_LOCATION }, alias = "mediaLocation")
    }
)
public class NativePhotoPickerPlugin extends Plugin {
    @PluginMethod
    public void pickPhoto(PluginCall call) {
        if (needsMediaLocationPermission()) {
            requestPermissionForAlias("mediaLocation", call, "mediaLocationPermissionCallback");
            return;
        }

        openPhotoPicker(call);
    }

    @PermissionCallback
    private void mediaLocationPermissionCallback(PluginCall call) {
        openPhotoPicker(call);
    }

    private boolean needsMediaLocationPermission() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q &&
            getPermissionState("mediaLocation") != PermissionState.GRANTED;
    }

    private void openPhotoPicker(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("image/*");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, intent, "photoPicked");
    }

    @ActivityCallback
    private void photoPicked(PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            call.reject("No photo selected.");
            return;
        }

        Uri uri = result.getData().getData();
        ContentResolver resolver = getContext().getContentResolver();
        int takeFlags = result.getData().getFlags() & Intent.FLAG_GRANT_READ_URI_PERMISSION;
        try {
            resolver.takePersistableUriPermission(uri, takeFlags);
        } catch (Exception ignored) {
            // Some providers grant temporary read access only.
        }

        String mimeType = resolver.getType(uri);
        String displayName = getDisplayName(resolver, uri);
        List<Uri> readCandidates = getReadCandidates(uri);
        double[] latLong = readLatLong(resolver, readCandidates);

        try {
            File copied = copyToCache(resolver, readCandidates, displayName);
            JSObject response = new JSObject();
            response.put("path", Uri.fromFile(copied).toString());
            response.put("name", displayName);
            response.put("mimeType", mimeType != null ? mimeType : "image/jpeg");
            if (latLong != null) {
                response.put("lat", latLong[0]);
                response.put("lng", latLong[1]);
            }
            call.resolve(response);
        } catch (Exception e) {
            call.reject("Could not read selected photo.", e);
        }
    }

    private List<Uri> getReadCandidates(Uri uri) {
        List<Uri> candidates = new ArrayList<>();
        addUri(candidates, requireOriginal(uri));
        addUri(candidates, uri);

        Uri mediaUri = toMediaStoreUri(uri);
        if (!mediaUri.equals(uri)) {
            addUri(candidates, requireOriginal(mediaUri));
            addUri(candidates, mediaUri);
        }
        return candidates;
    }

    private Uri requireOriginal(Uri uri) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            return uri;
        }
        try {
            return MediaStore.setRequireOriginal(uri);
        } catch (Exception ignored) {
            return uri;
        }
    }

    private void addUri(List<Uri> candidates, Uri uri) {
        for (Uri candidate : candidates) {
            if (candidate.toString().equals(uri.toString())) {
                return;
            }
        }
        candidates.add(uri);
    }

    private Uri toMediaStoreUri(Uri uri) {
        if (!DocumentsContract.isDocumentUri(getContext(), uri)) {
            return uri;
        }

        if (!"com.android.providers.media.documents".equals(uri.getAuthority())) {
            return uri;
        }

        try {
            String docId = DocumentsContract.getDocumentId(uri);
            String[] parts = docId.split(":");
            if (parts.length < 2 || !"image".equals(parts[0])) {
                return uri;
            }
            long id = Long.parseLong(parts[1]);
            return ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, id);
        } catch (Exception ignored) {
            return uri;
        }
    }

    private double[] readLatLong(ContentResolver resolver, List<Uri> candidates) {
        for (Uri uri : candidates) {
            try (InputStream stream = resolver.openInputStream(uri)) {
                if (stream == null) {
                    continue;
                }
                ExifInterface exif = new ExifInterface(stream);
                double[] latLong = exif.getLatLong();
                if (latLong == null || latLong.length < 2) {
                    continue;
                }
                if (!isValidCoord(latLong[0], latLong[1])) {
                    continue;
                }
                return latLong;
            } catch (Exception ignored) {
                // Try the next URI shape/provider.
            }
        }
        return null;
    }

    private boolean isValidCoord(double lat, double lng) {
        return Double.isFinite(lat) &&
            Double.isFinite(lng) &&
            Math.abs(lat) <= 90 &&
            Math.abs(lng) <= 180 &&
            !(lat == 0 && lng == 0);
    }

    private String getDisplayName(ContentResolver resolver, Uri uri) {
        try (Cursor cursor = resolver.query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (nameIndex >= 0) {
                    String name = cursor.getString(nameIndex);
                    if (name != null && !name.trim().isEmpty()) {
                        return name;
                    }
                }
            }
        } catch (Exception ignored) {
            // Fall back below.
        }
        return "photo.jpg";
    }

    private File copyToCache(ContentResolver resolver, List<Uri> candidates, String displayName) throws Exception {
        InputStream stream = null;
        for (Uri candidate : candidates) {
            try {
                stream = resolver.openInputStream(candidate);
                if (stream != null) {
                    break;
                }
            } catch (Exception ignored) {
                // Try the next URI shape/provider.
            }
        }
        if (stream == null) {
            throw new IllegalStateException("Could not open selected photo.");
        }

        File dir = new File(getContext().getCacheDir(), "native-photo-picker");
        if (!dir.exists() && !dir.mkdirs()) {
            throw new IllegalStateException("Could not create photo cache.");
        }

        String extension = extensionFromName(displayName);
        File output = new File(dir, UUID.randomUUID().toString() + extension);
        try (InputStream input = stream; FileOutputStream out = new FileOutputStream(output)) {
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = input.read(buffer)) != -1) {
                out.write(buffer, 0, read);
            }
        }
        return output;
    }

    private String extensionFromName(String name) {
        if (name == null) {
            return ".jpg";
        }
        int dot = name.lastIndexOf('.');
        if (dot < 0 || dot == name.length() - 1) {
            return ".jpg";
        }
        String ext = name.substring(dot).replaceAll("[^A-Za-z0-9.]", "");
        if (ext.length() < 2 || ext.length() > 10) {
            return ".jpg";
        }
        return ext;
    }
}
