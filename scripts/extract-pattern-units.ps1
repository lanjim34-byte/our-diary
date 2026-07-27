$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing

Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public static class PatternUnitExtractor
{
    public static Rectangle[] GetUnitBoxes(string transparentPath, int cellSize, int padding, int alphaThreshold)
    {
        using (Bitmap bitmap = new Bitmap(transparentPath))
        {
            Rectangle imageRect = new Rectangle(0, 0, bitmap.Width, bitmap.Height);
            BitmapData data = bitmap.LockBits(imageRect, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
            int bytesLen = Math.Abs(data.Stride) * bitmap.Height;
            byte[] bytes = new byte[bytesLen];
            Marshal.Copy(data.Scan0, bytes, 0, bytesLen);
            bitmap.UnlockBits(data);

            int cols = (int)Math.Ceiling(bitmap.Width / (double)cellSize);
            int rows = (int)Math.Ceiling(bitmap.Height / (double)cellSize);
            bool[,] occupied = new bool[cols, rows];

            for (int y = 0; y < bitmap.Height; y++)
            {
                int row = y * data.Stride;
                int cy = y / cellSize;
                for (int x = 0; x < bitmap.Width; x++)
                {
                    int idx = row + x * 4;
                    if (bytes[idx + 3] > alphaThreshold)
                    {
                        occupied[x / cellSize, cy] = true;
                    }
                }
            }

            bool[,] expanded = new bool[cols, rows];
            for (int x = 0; x < cols; x++)
            {
                for (int y = 0; y < rows; y++)
                {
                    if (!occupied[x, y]) continue;
                    for (int dx = -1; dx <= 1; dx++)
                    {
                        for (int dy = -1; dy <= 1; dy++)
                        {
                            int nx = x + dx;
                            int ny = y + dy;
                            if (nx >= 0 && nx < cols && ny >= 0 && ny < rows)
                            {
                                expanded[nx, ny] = true;
                            }
                        }
                    }
                }
            }

            bool[,] visited = new bool[cols, rows];
            List<Rectangle> boxes = new List<Rectangle>();
            int[] qx = new int[cols * rows];
            int[] qy = new int[cols * rows];
            int[] ox = new int[] { 1, -1, 0, 0 };
            int[] oy = new int[] { 0, 0, 1, -1 };

            for (int sx = 0; sx < cols; sx++)
            {
                for (int sy = 0; sy < rows; sy++)
                {
                    if (!expanded[sx, sy] || visited[sx, sy]) continue;
                    int head = 0;
                    int tail = 0;
                    qx[tail] = sx;
                    qy[tail] = sy;
                    tail++;
                    visited[sx, sy] = true;
                    int minX = sx, maxX = sx, minY = sy, maxY = sy;

                    while (head < tail)
                    {
                        int cx = qx[head];
                        int cy = qy[head];
                        head++;
                        if (cx < minX) minX = cx;
                        if (cx > maxX) maxX = cx;
                        if (cy < minY) minY = cy;
                        if (cy > maxY) maxY = cy;

                        for (int i = 0; i < 4; i++)
                        {
                            int nx = cx + ox[i];
                            int ny = cy + oy[i];
                            if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
                            if (!expanded[nx, ny] || visited[nx, ny]) continue;
                            visited[nx, ny] = true;
                            qx[tail] = nx;
                            qy[tail] = ny;
                            tail++;
                        }
                    }

                    Rectangle rough = Rectangle.FromLTRB(
                        Math.Max(0, minX * cellSize - padding),
                        Math.Max(0, minY * cellSize - padding),
                        Math.Min(bitmap.Width, (maxX + 1) * cellSize + padding),
                        Math.Min(bitmap.Height, (maxY + 1) * cellSize + padding)
                    );
                    Rectangle refined = RefineAlphaBounds(bytes, data.Stride, bitmap.Width, bitmap.Height, rough, alphaThreshold);
                    if (refined.Width <= 0 || refined.Height <= 0) continue;
                    refined.Inflate(padding, padding);
                    refined.Intersect(imageRect);

                    int alphaPixels = CountAlpha(bytes, data.Stride, refined, alphaThreshold);
                    int boxArea = refined.Width * refined.Height;
                    double imageCoverage = boxArea / (double)(bitmap.Width * bitmap.Height);
                    double aspect = refined.Width / (double)refined.Height;
                    if (refined.Width < 24 || refined.Height < 24 || alphaPixels < 70) continue;
                    if (refined.Height < 38 && refined.Width > 110) continue;
                    if (aspect > 6.0 || aspect < 0.16) continue;
                    if (imageCoverage > 0.92) continue;
                    boxes.Add(refined);
                }
            }

            boxes.Sort((a, b) => {
                int byTop = a.Top.CompareTo(b.Top);
                if (byTop != 0) return byTop;
                return a.Left.CompareTo(b.Left);
            });

            return boxes.ToArray();
        }
    }

    public static void Crop(string sourcePath, string targetPath, Rectangle crop)
    {
        using (Bitmap source = new Bitmap(sourcePath))
        using (Bitmap output = new Bitmap(crop.Width, crop.Height, PixelFormat.Format32bppArgb))
        using (Graphics graphics = Graphics.FromImage(output))
        {
            graphics.Clear(Color.Transparent);
            graphics.DrawImage(source, new Rectangle(0, 0, crop.Width, crop.Height), crop, GraphicsUnit.Pixel);
            output.Save(targetPath, ImageFormat.Png);
        }
    }

    public static bool HasLongCutEdge(string transparentPath, Rectangle crop, int alphaThreshold, int runThreshold)
    {
        using (Bitmap bitmap = new Bitmap(transparentPath))
        {
            Rectangle imageRect = new Rectangle(0, 0, bitmap.Width, bitmap.Height);
            BitmapData data = bitmap.LockBits(imageRect, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
            int bytesLen = Math.Abs(data.Stride) * bitmap.Height;
            byte[] bytes = new byte[bytesLen];
            Marshal.Copy(data.Scan0, bytes, 0, bytesLen);
            bitmap.UnlockBits(data);

            if (crop.Left <= 0 && LongestVerticalRun(bytes, data.Stride, crop.Left, crop.Top, crop.Bottom, alphaThreshold) >= runThreshold) return true;
            if (crop.Top <= 0 && LongestHorizontalRun(bytes, data.Stride, crop.Top, crop.Left, crop.Right, alphaThreshold) >= runThreshold) return true;
            if (crop.Right >= bitmap.Width && LongestVerticalRun(bytes, data.Stride, crop.Right - 1, crop.Top, crop.Bottom, alphaThreshold) >= runThreshold) return true;
            if (crop.Bottom >= bitmap.Height && LongestHorizontalRun(bytes, data.Stride, crop.Bottom - 1, crop.Left, crop.Right, alphaThreshold) >= runThreshold) return true;

            return false;
        }
    }

    public static bool HasSourceEdgeCutEvidence(string transparentPath, Rectangle crop, int alphaThreshold, int edgeBand, int runThreshold)
    {
        using (Bitmap bitmap = new Bitmap(transparentPath))
        {
            Rectangle imageRect = new Rectangle(0, 0, bitmap.Width, bitmap.Height);
            BitmapData data = bitmap.LockBits(imageRect, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
            int bytesLen = Math.Abs(data.Stride) * bitmap.Height;
            byte[] bytes = new byte[bytesLen];
            Marshal.Copy(data.Scan0, bytes, 0, bytesLen);
            bitmap.UnlockBits(data);

            int margin = Math.Max(8, edgeBand);
            if (crop.Left <= margin && EdgeBandHasCut(bytes, data.Stride, crop, "left", bitmap.Width, bitmap.Height, alphaThreshold, edgeBand, runThreshold)) return true;
            if (crop.Top <= margin && EdgeBandHasCut(bytes, data.Stride, crop, "top", bitmap.Width, bitmap.Height, alphaThreshold, edgeBand, runThreshold)) return true;
            if (crop.Right >= bitmap.Width - margin && EdgeBandHasCut(bytes, data.Stride, crop, "right", bitmap.Width, bitmap.Height, alphaThreshold, edgeBand, runThreshold)) return true;
            if (crop.Bottom >= bitmap.Height - margin && EdgeBandHasCut(bytes, data.Stride, crop, "bottom", bitmap.Width, bitmap.Height, alphaThreshold, edgeBand, runThreshold)) return true;

            return false;
        }
    }

    private static Rectangle RefineAlphaBounds(byte[] bytes, int stride, int width, int height, Rectangle rough, int alphaThreshold)
    {
        int minX = width, minY = height, maxX = -1, maxY = -1;
        for (int y = rough.Top; y < rough.Bottom; y++)
        {
            int row = y * stride;
            for (int x = rough.Left; x < rough.Right; x++)
            {
                int idx = row + x * 4;
                if (bytes[idx + 3] <= alphaThreshold) continue;
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
        }
        if (maxX < minX || maxY < minY) return Rectangle.Empty;
        return Rectangle.FromLTRB(minX, minY, maxX + 1, maxY + 1);
    }

    private static int CountAlpha(byte[] bytes, int stride, Rectangle rect, int alphaThreshold)
    {
        int count = 0;
        for (int y = rect.Top; y < rect.Bottom; y++)
        {
            int row = y * stride;
            for (int x = rect.Left; x < rect.Right; x++)
            {
                int idx = row + x * 4;
                if (bytes[idx + 3] > alphaThreshold) count++;
            }
        }
        return count;
    }

    private static int LongestHorizontalRun(byte[] bytes, int stride, int y, int left, int right, int alphaThreshold)
    {
        int current = 0;
        int longest = 0;
        int row = y * stride;
        for (int x = left; x < right; x++)
        {
            int idx = row + x * 4;
            if (bytes[idx + 3] > alphaThreshold)
            {
                current++;
                if (current > longest) longest = current;
            }
            else
            {
                current = 0;
            }
        }
        return longest;
    }

    private static int LongestVerticalRun(byte[] bytes, int stride, int x, int top, int bottom, int alphaThreshold)
    {
        int current = 0;
        int longest = 0;
        for (int y = top; y < bottom; y++)
        {
            int idx = y * stride + x * 4;
            if (bytes[idx + 3] > alphaThreshold)
            {
                current++;
                if (current > longest) longest = current;
            }
            else
            {
                current = 0;
            }
        }
        return longest;
    }

    private static bool EdgeBandHasCut(byte[] bytes, int stride, Rectangle crop, string edge, int width, int height, int alphaThreshold, int edgeBand, int runThreshold)
    {
        int alphaPixels = 0;
        int longest = 0;
        int scanLines = Math.Max(1, edgeBand);

        if (edge == "top" || edge == "bottom")
        {
            int yStart = edge == "top" ? 0 : Math.Max(0, height - scanLines);
            int yEnd = edge == "top" ? Math.Min(height, scanLines) : height;
            int left = Math.Max(0, crop.Left);
            int right = Math.Min(width, crop.Right);
            for (int y = yStart; y < yEnd; y++)
            {
                int run = LongestHorizontalRun(bytes, stride, y, left, right, alphaThreshold);
                if (run > longest) longest = run;
                alphaPixels += CountAlpha(bytes, stride, Rectangle.FromLTRB(left, y, right, y + 1), alphaThreshold);
            }
            int densityTrigger = Math.Max(28, (right - left) / 11);
            return longest >= runThreshold || alphaPixels >= densityTrigger;
        }

        int xStart = edge == "left" ? 0 : Math.Max(0, width - scanLines);
        int xEnd = edge == "left" ? Math.Min(width, scanLines) : width;
        int top = Math.Max(0, crop.Top);
        int bottom = Math.Min(height, crop.Bottom);
        for (int x = xStart; x < xEnd; x++)
        {
            int run = LongestVerticalRun(bytes, stride, x, top, bottom, alphaThreshold);
            if (run > longest) longest = run;
            alphaPixels += CountAlpha(bytes, stride, Rectangle.FromLTRB(x, top, x + 1, bottom), alphaThreshold);
        }
        int densityTriggerSide = Math.Max(28, (bottom - top) / 11);
        return longest >= runThreshold || alphaPixels >= densityTriggerSide;
    }
}
"@

$patternsDir = Join-Path (Get-Location) "public\patterns"
$unitsDir = Join-Path $patternsDir "units"
New-Item -ItemType Directory -Force -Path $unitsDir | Out-Null
Get-ChildItem -Path $unitsDir -File | Remove-Item

$variants = @("transparent", "brown", "cream", "green", "yellow", "pink")
$manifest = @()

$transparentFiles = Get-ChildItem -Path $patternsDir -File -Filter "floral-*-transparent.png" | Sort-Object Name

foreach ($transparentFile in $transparentFiles) {
  if ($transparentFile.BaseName -notmatch "^floral-(\d+)-transparent$") {
    continue
  }
  $sourceNumber = $Matches[1]
  $transparentPath = $transparentFile.FullName

  $boxes = [PatternUnitExtractor]::GetUnitBoxes($transparentPath, 8, 14, 18)
  $unitIndex = 1

  foreach ($box in $boxes) {
    if ($sourceNumber -eq "02" -and $box.Y -gt 860 -and $box.Height -lt 90) {
      continue
    }
    $cutRunThreshold = [Math]::Max(34, [int]([Math]::Min($box.Width, $box.Height) * 0.28))
    if ([PatternUnitExtractor]::HasLongCutEdge($transparentPath, $box, 18, $cutRunThreshold)) {
      continue
    }
    $edgeBand = 18
    $edgeRunThreshold = [Math]::Max(18, [int]([Math]::Min($box.Width, $box.Height) * 0.12))
    if ([PatternUnitExtractor]::HasSourceEdgeCutEvidence($transparentPath, $box, 18, $edgeBand, $edgeRunThreshold)) {
      continue
    }

    if ($unitIndex -gt 24) {
      break
    }

    $unitNumber = "{0:D2}" -f $unitIndex
    $outputs = @()
    foreach ($variant in $variants) {
      $sourceVariant = Join-Path $patternsDir "floral-$sourceNumber-$variant.png"
      if (!(Test-Path $sourceVariant)) {
        continue
      }
      $fileName = "floral-$sourceNumber-unit-$unitNumber-$variant.png"
      $target = Join-Path $unitsDir $fileName
      [PatternUnitExtractor]::Crop($sourceVariant, $target, $box)
      $outputs += $fileName
    }

    $manifest += [ordered]@{
      source = "floral-$sourceNumber"
      unit = $unitNumber
      x = $box.X
      y = $box.Y
      width = $box.Width
      height = $box.Height
      outputs = $outputs
    }
    $unitIndex++
  }
}

$manifest | ConvertTo-Json -Depth 5 | Set-Content -Path (Join-Path $unitsDir "pattern-units-manifest.json") -Encoding UTF8
Write-Output "Extracted $($manifest.Count) pattern units into $unitsDir"
