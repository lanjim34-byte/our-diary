$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing

Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public static class PatternProcessor
{
    public static void Process(string sourcePath, string targetPath, int tintR, int tintG, int tintB, double tintAlpha, bool useTint)
    {
        using (Bitmap original = new Bitmap(sourcePath))
        using (Bitmap source = new Bitmap(original.Width, original.Height, PixelFormat.Format32bppArgb))
        using (Graphics graphics = Graphics.FromImage(source))
        using (Bitmap output = new Bitmap(original.Width, original.Height, PixelFormat.Format32bppArgb))
        {
            graphics.DrawImage(original, 0, 0, original.Width, original.Height);
            double[] bg = EstimateBackground(source);

            Rectangle rect = new Rectangle(0, 0, source.Width, source.Height);
            BitmapData srcData = source.LockBits(rect, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
            BitmapData outData = output.LockBits(rect, ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
            int srcBytesLen = Math.Abs(srcData.Stride) * source.Height;
            int outBytesLen = Math.Abs(outData.Stride) * output.Height;
            byte[] srcBytes = new byte[srcBytesLen];
            byte[] outBytes = new byte[outBytesLen];
            Marshal.Copy(srcData.Scan0, srcBytes, 0, srcBytesLen);

            for (int y = 0; y < source.Height; y++)
            {
                int row = y * srcData.Stride;
                int outRow = y * outData.Stride;
                for (int x = 0; x < source.Width; x++)
                {
                    int idx = row + x * 4;
                    int outIdx = outRow + x * 4;
                    byte b = srcBytes[idx + 0];
                    byte g = srcBytes[idx + 1];
                    byte r = srcBytes[idx + 2];
                    byte a = srcBytes[idx + 3];

                    double dr = r - bg[0];
                    double dg = g - bg[1];
                    double db = b - bg[2];
                    double distance = Math.Sqrt(dr * dr + dg * dg + db * db);
                    double alpha = (distance - 16.0) / 86.0;
                    alpha = Math.Max(0, Math.Min(1, alpha));
                    alpha = Math.Pow(alpha, 0.72);
                    alpha *= a / 255.0;

                    if (alpha < 0.025)
                    {
                        outBytes[outIdx + 0] = 255;
                        outBytes[outIdx + 1] = 255;
                        outBytes[outIdx + 2] = 255;
                        outBytes[outIdx + 3] = 0;
                    }
                    else if (useTint)
                    {
                        outBytes[outIdx + 0] = (byte)tintB;
                        outBytes[outIdx + 1] = (byte)tintG;
                        outBytes[outIdx + 2] = (byte)tintR;
                        outBytes[outIdx + 3] = (byte)Math.Round(255 * alpha * tintAlpha);
                    }
                    else
                    {
                        outBytes[outIdx + 0] = b;
                        outBytes[outIdx + 1] = g;
                        outBytes[outIdx + 2] = r;
                        outBytes[outIdx + 3] = (byte)Math.Round(255 * Math.Min(0.92, alpha));
                    }
                }
            }

            Marshal.Copy(outBytes, 0, outData.Scan0, outBytesLen);
            source.UnlockBits(srcData);
            output.UnlockBits(outData);
            output.Save(targetPath, ImageFormat.Png);
        }
    }

    private static double[] EstimateBackground(Bitmap bitmap)
    {
        int[] counts = new int[4096];
        double[] sumsR = new double[4096];
        double[] sumsG = new double[4096];
        double[] sumsB = new double[4096];
        int stepX = Math.Max(1, bitmap.Width / 180);
        int stepY = Math.Max(1, bitmap.Height / 180);

        for (int y = 0; y < bitmap.Height; y += stepY)
        {
            for (int x = 0; x < bitmap.Width; x += stepX)
            {
                AddSample(bitmap.GetPixel(x, y), counts, sumsR, sumsG, sumsB);
            }
        }

        int best = 0;
        for (int i = 1; i < counts.Length; i++)
        {
            if (counts[i] == 0) continue;
            double brightness = ((sumsR[i] + sumsG[i] + sumsB[i]) / counts[i]) / 3.0;
            double bestBrightness = counts[best] == 0 ? 0 : ((sumsR[best] + sumsG[best] + sumsB[best]) / counts[best]) / 3.0;
            double score = counts[i] * (0.72 + brightness / 255.0);
            double bestScore = counts[best] * (0.72 + bestBrightness / 255.0);
            if (score > bestScore) best = i;
        }

        if (counts[best] == 0) return new double[] { 255, 255, 255 };
        return new double[] { sumsR[best] / counts[best], sumsG[best] / counts[best], sumsB[best] / counts[best] };
    }

    private static void AddSample(Color color, int[] counts, double[] sumsR, double[] sumsG, double[] sumsB)
    {
        int key = ((color.R >> 4) << 8) | ((color.G >> 4) << 4) | (color.B >> 4);
        counts[key]++;
        sumsR[key] += color.R;
        sumsG[key] += color.G;
        sumsB[key] += color.B;
    }
}
"@

$bgPatternDir = Join-Path (Get-Location) "BG pattern"
$floralDir = Join-Path $bgPatternDir "floral"
$sourceDir = if (Test-Path $floralDir) { $floralDir } else { $bgPatternDir }
$outputDir = Join-Path (Get-Location) "public\patterns"
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

$variants = @(
  @{ suffix = "brown";  color = "#5b4434"; alpha = 0.62 },
  @{ suffix = "cream";  color = "#fff7e8"; alpha = 0.56 },
  @{ suffix = "green";  color = "#8fa66f"; alpha = 0.50 },
  @{ suffix = "yellow"; color = "#c7a85b"; alpha = 0.46 },
  @{ suffix = "pink";   color = "#c58b86"; alpha = 0.48 }
)

function Convert-HexToRgb($hex) {
  $clean = $hex.TrimStart("#")
  return @{
    r = [Convert]::ToInt32($clean.Substring(0, 2), 16)
    g = [Convert]::ToInt32($clean.Substring(2, 2), 16)
    b = [Convert]::ToInt32($clean.Substring(4, 2), 16)
  }
}

$files = Get-ChildItem -Path $sourceDir -File -Filter *.png | Sort-Object Name
$manifest = @()

for ($i = 0; $i -lt $files.Count; $i++) {
  $number = "{0:D2}" -f ($i + 1)
  $base = "floral-$number"
  $source = $files[$i].FullName
  $transparent = Join-Path $outputDir "$base-transparent.png"
  [PatternProcessor]::Process($source, $transparent, 0, 0, 0, 1.0, $false)

  foreach ($variant in $variants) {
    $rgb = Convert-HexToRgb $variant.color
    $target = Join-Path $outputDir "$base-$($variant.suffix).png"
    [PatternProcessor]::Process($source, $target, $rgb.r, $rgb.g, $rgb.b, $variant.alpha, $true)
  }

  $manifest += [ordered]@{
    source = $files[$i].Name
    outputs = @(
      "$base-transparent.png",
      "$base-brown.png",
      "$base-cream.png",
      "$base-green.png",
      "$base-yellow.png",
      "$base-pink.png"
    )
  }
}

$manifest | ConvertTo-Json -Depth 4 | Set-Content -Path (Join-Path $outputDir "pattern-manifest.json") -Encoding UTF8
Write-Output "Processed $($files.Count) PNG files into $outputDir"
