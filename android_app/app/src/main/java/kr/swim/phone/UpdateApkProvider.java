package kr.swim.phone;

import android.content.*;
import android.database.*;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import java.io.*;

/** Only the verified APK may be shared, read-only, with the Android installer. */
public final class UpdateApkProvider extends ContentProvider {
    static final Uri URI=Uri.parse("content://kr.swim.phone.updates/update.apk");
    static File file(Context context){return new File(context.getCacheDir(),"verified-update.apk");}
    void require(Uri uri){if(!URI.equals(uri))throw new IllegalArgumentException("Unknown update file");}
    public boolean onCreate(){return true;}
    public String getType(Uri uri){require(uri);return "application/vnd.android.package-archive";}
    public ParcelFileDescriptor openFile(Uri uri,String mode)throws FileNotFoundException{require(uri);if(!"r".equals(mode))throw new FileNotFoundException("Read only");return ParcelFileDescriptor.open(file(getContext()),ParcelFileDescriptor.MODE_READ_ONLY);}
    public Cursor query(Uri uri,String[] projection,String selection,String[] args,String order){require(uri);String[] columns=projection==null?new String[]{OpenableColumns.DISPLAY_NAME,OpenableColumns.SIZE}:projection;MatrixCursor cursor=new MatrixCursor(columns);Object[] row=new Object[columns.length];for(int i=0;i<columns.length;i++)row[i]=OpenableColumns.DISPLAY_NAME.equals(columns[i])?"swim-update.apk":OpenableColumns.SIZE.equals(columns[i])?file(getContext()).length():null;cursor.addRow(row);return cursor;}
    public Uri insert(Uri uri,ContentValues values){throw new UnsupportedOperationException();}
    public int update(Uri uri,ContentValues values,String selection,String[] args){throw new UnsupportedOperationException();}
    public int delete(Uri uri,String selection,String[] args){throw new UnsupportedOperationException();}
}
