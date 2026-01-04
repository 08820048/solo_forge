import { NextRequest, NextResponse } from 'next/server';
import { upload, resizeImage, saveImage } from '@/lib/upload';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    const thumbnailBuffer = await resizeImage(buffer, 300, 300);
    const originalBuffer = await resizeImage(buffer, 1200, 800);

    const timestamp = Date.now();
    const originalFilename = `${timestamp}_original.jpg`;
    const thumbnailFilename = `${timestamp}_thumb.jpg`;

    const [originalPath, thumbnailPath] = await Promise.all([
      saveImage(originalBuffer, originalFilename),
      saveImage(thumbnailBuffer, thumbnailFilename)
    ]);

    return NextResponse.json({
      success: true,
      data: {
        originalUrl: originalPath,
        thumbnailUrl: thumbnailPath,
        filename: file.name,
        size: file.size,
        type: file.type,
      },
    });
  } catch (error) {
    console.error('Upload error:', error);
    return NextResponse.json(
      { error: 'Failed to upload file' },
      { status: 500 }
    );
  }
}