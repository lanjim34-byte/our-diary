$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public static class WoodPatternBuilder
{
    public static void BuildTile(string sourcePath, string targetPath, string edgeTargetPath, int tileSize)
    {
        int half = tileSize / 2;
        using (Bitmap srcOriginal = new Bitmap(sourcePath))
        using (Bitmap crop = CenterCrop(srcOriginal, half, half))
        using (Bitmap output = new Bitmap(tileSize, tileSize, PixelFormat.Format32bppArgb))
        using (Graphics g = Graphics.FromImage(output))
        {
            g.Clear(Color.Transparent);
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.SmoothingMode = SmoothingMode.HighQuality;
            DrawAdjusted(g, crop, new Rectangle(0, 0, half, half), false, false);
            DrawAdjusted(g, crop, new Rectangle(half, 0, half, half), true, false);
            DrawAdjusted(g, crop, new Rectangle(0, half, half, half), false, true);
            DrawAdjusted(g, crop, new Rectangle(half, half, half, half), true, true);
            output.Save(targetPath, ImageFormat.Png);
            SaveEdgeTexture(output, edgeTargetPath);
        }
    }

    private static Bitmap CenterCrop(Bitmap source, int targetWidth, int targetHeight)
    {
        double scale = Math.Max(targetWidth / (double)source.Width, targetHeight / (double)source.Height);
        int scaledWidth = (int)Math.Ceiling(source.Width * scale);
        int scaledHeight = (int)Math.Ceiling(source.Height * scale);
        using (Bitmap scaled = new Bitmap(scaledWidth, scaledHeight, PixelFormat.Format32bppArgb))
        using (Graphics sg = Graphics.FromImage(scaled))
        {
            sg.InterpolationMode = InterpolationMode.HighQualityBicubic;
            sg.DrawImage(source, 0, 0, scaledWidth, scaledHeight);
            int x = Math.Max(0, (scaledWidth - targetWidth) / 2);
            int y = Math.Max(0, (scaledHeight - targetHeight) / 2);
            Bitmap result = new Bitmap(targetWidth, targetHeight, PixelFormat.Format32bppArgb);
            using (Graphics rg = Graphics.FromImage(result))
            {
                rg.DrawImage(scaled, new Rectangle(0, 0, targetWidth, targetHeight), new Rectangle(x, y, targetWidth, targetHeight), GraphicsUnit.Pixel);
            }
            SoftenAndTint(result);
            return result;
        }
    }

    private static void DrawAdjusted(Graphics g, Bitmap image, Rectangle dest, bool flipX, bool flipY)
    {
        GraphicsState state = g.Save();
        g.TranslateTransform(dest.Left + (flipX ? dest.Width : 0), dest.Top + (flipY ? dest.Height : 0));
        g.ScaleTransform(flipX ? -1 : 1, flipY ? -1 : 1);
        g.DrawImage(image, new Rectangle(0, 0, dest.Width, dest.Height));
        g.Restore(state);
    }

    private static void SoftenAndTint(Bitmap bitmap)
    {
        Rectangle rect = new Rectangle(0, 0, bitmap.Width, bitmap.Height);
        BitmapData data = bitmap.LockBits(rect, ImageLockMode.ReadWrite, PixelFormat.Format32bppArgb);
        int len = Math.Abs(data.Stride) * bitmap.Height;
        byte[] bytes = new byte[len];
        Marshal.Copy(data.Scan0, bytes, 0, len);

        for (int y = 0; y < bitmap.Height; y++)
        {
            int row = y * data.Stride;
            for (int x = 0; x < bitmap.Width; x++)
            {
                int idx = row + x * 4;
                double b = bytes[idx + 0];
                double g = bytes[idx + 1];
                double r = bytes[idx + 2];
                double gray = r * 0.299 + g * 0.587 + b * 0.114;
                double contrast = (gray - 128.0) * 0.74 + 128.0;
                double warmR = 226 + (contrast - 128.0) * 0.92;
                double warmG = 207 + (contrast - 128.0) * 0.72;
                double warmB = 176 + (contrast - 128.0) * 0.52;
                bytes[idx + 2] = Clamp(warmR);
                bytes[idx + 1] = Clamp(warmG);
                bytes[idx + 0] = Clamp(warmB);
                bytes[idx + 3] = 255;
            }
        }

        Marshal.Copy(bytes, 0, data.Scan0, len);
        bitmap.UnlockBits(data);
    }

    private static void SaveEdgeTexture(Bitmap source, string targetPath)
    {
        Rectangle rect = new Rectangle(0, 0, source.Width, source.Height);
        BitmapData srcData = source.LockBits(rect, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
        int len = Math.Abs(srcData.Stride) * source.Height;
        byte[] src = new byte[len];
        Marshal.Copy(srcData.Scan0, src, 0, len);
        source.UnlockBits(srcData);

        using (Bitmap edge = new Bitmap(source.Width, source.Height, PixelFormat.Format32bppArgb))
        {
            BitmapData edgeData = edge.LockBits(rect, ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
            byte[] dst = new byte[Math.Abs(edgeData.Stride) * edge.Height];

            for (int y = 0; y < source.Height; y++)
            {
                int row = y * srcData.Stride;
                int outRow = y * edgeData.Stride;
                int yPrev = ((y - 1 + source.Height) % source.Height) * srcData.Stride;
                int yNext = ((y + 1) % source.Height) * srcData.Stride;
                for (int x = 0; x < source.Width; x++)
                {
                    int xPrev = (x - 1 + source.Width) % source.Width;
                    int xNext = (x + 1) % source.Width;
                    double left = Luma(src, row + xPrev * 4);
                    double right = Luma(src, row + xNext * 4);
                    double up = Luma(src, yPrev + x * 4);
                    double down = Luma(src, yNext + x * 4);
                    double strength = Math.Sqrt((right - left) * (right - left) + (down - up) * (down - up));
                    double alpha = Math.Max(0, (strength - 8.5) / 22.0);
                    alpha = Math.Min(1, Math.Pow(alpha, 1.08));

                    int outIdx = outRow + x * 4;
                    dst[outIdx + 0] = 78;
                    dst[outIdx + 1] = 96;
                    dst[outIdx + 2] = 118;
                    dst[outIdx + 3] = (byte)Math.Round(82 * alpha);
                }
            }

            SuppressStraightSeams(dst, edgeData.Stride, source.Width, source.Height);
            Marshal.Copy(dst, 0, edgeData.Scan0, dst.Length);
            edge.UnlockBits(edgeData);
            edge.Save(targetPath, ImageFormat.Png);
        }
    }

    private static void SuppressStraightSeams(byte[] bytes, int stride, int width, int height)
    {
        for (int y = 0; y < height; y++)
        {
            int row = y * stride;
            int count = 0;
            int sum = 0;
            for (int x = 0; x < width; x++)
            {
                int alpha = bytes[row + x * 4 + 3];
                if (alpha > 8)
                {
                    count++;
                    sum += alpha;
                }
            }
            if (count > width * 0.62 && sum / Math.Max(1, count) > 18 || count > width * 0.78 && sum / Math.Max(1, count) > 8)
            {
                ClearHorizontalBand(bytes, stride, width, height, y);
            }
        }

        for (int x = 0; x < width; x++)
        {
            int count = 0;
            int sum = 0;
            for (int y = 0; y < height; y++)
            {
                int alpha = bytes[y * stride + x * 4 + 3];
                if (alpha > 8)
                {
                    count++;
                    sum += alpha;
                }
            }
            if (count > height * 0.62 && sum / Math.Max(1, count) > 18 || count > height * 0.78 && sum / Math.Max(1, count) > 8)
            {
                ClearVerticalBand(bytes, stride, width, height, x);
            }
        }
    }

    private static void ClearHorizontalBand(byte[] bytes, int stride, int width, int height, int centerY)
    {
        for (int y = Math.Max(0, centerY - 1); y <= Math.Min(height - 1, centerY + 1); y++)
        {
            int row = y * stride;
            for (int x = 0; x < width; x++)
            {
                bytes[row + x * 4 + 3] = 0;
            }
        }
    }

    private static void ClearVerticalBand(byte[] bytes, int stride, int width, int height, int centerX)
    {
        for (int x = Math.Max(0, centerX - 1); x <= Math.Min(width - 1, centerX + 1); x++)
        {
            for (int y = 0; y < height; y++)
            {
                bytes[y * stride + x * 4 + 3] = 0;
            }
        }
    }

    private static double Luma(byte[] bytes, int idx)
    {
        return bytes[idx + 2] * 0.299 + bytes[idx + 1] * 0.587 + bytes[idx + 0] * 0.114;
    }

    private static byte Clamp(double value)
    {
        return (byte)Math.Max(0, Math.Min(255, Math.Round(value)));
    }
}
"@

$sourceDir = Join-Path (Get-Location) "BG pattern\wood"
$outputDir = Join-Path (Get-Location) "public\patterns\wood"
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
Get-ChildItem -Path $outputDir -File -Filter "wood-*.png" | Remove-Item

$files = Get-ChildItem -Path $sourceDir -File -Filter *.png | Sort-Object Name
$manifest = @()
for ($i = 0; $i -lt $files.Count; $i++) {
  $name = "wood-{0:D2}-tile.png" -f ($i + 1)
  $edgeName = "wood-{0:D2}-edge.png" -f ($i + 1)
  $target = Join-Path $outputDir $name
  $edgeTarget = Join-Path $outputDir $edgeName
  [WoodPatternBuilder]::BuildTile($files[$i].FullName, $target, $edgeTarget, 720)
  $manifest += [ordered]@{ source = $files[$i].Name; output = $name; edgeOutput = $edgeName; size = 720 }
}
$manifest | ConvertTo-Json -Depth 4 | Set-Content -Path (Join-Path $outputDir "wood-manifest.json") -Encoding UTF8
Write-Output "Processed $($files.Count) wood textures into $outputDir"
