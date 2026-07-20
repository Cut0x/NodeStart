# Génère le logo NodeStart (hexagone vert Node.js + glyphe terminal ">_")
# en 3 tailles identiques (petit/moyen/grand), plus une icône .ico pour Windows.
# Aucune dépendance externe : uniquement System.Drawing (GDI+), déjà présent sous Windows.

Add-Type -AssemblyName System.Drawing

function New-NodeStartLogo {
    param(
        [int]$Size,
        [string]$OutPath
    )

    $bmp = New-Object System.Drawing.Bitmap $Size, $Size
    $bmp.SetResolution(96, 96)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)

    $cx = $Size / 2.0
    $cy = $Size / 2.0
    $r = $Size * 0.46

    # Hexagone "pointes à gauche/droite" (même orientation que le logo officiel Node.js)
    $points = New-Object System.Collections.Generic.List[System.Drawing.PointF]
    for ($i = 0; $i -lt 6; $i++) {
        $angle = [Math]::PI / 180.0 * (60.0 * $i)
        $x = $cx + $r * [Math]::Cos($angle)
        $y = $cy + $r * [Math]::Sin($angle)
        $points.Add((New-Object System.Drawing.PointF([float]$x, [float]$y)))
    }
    $pointsArray = $points.ToArray()

    # Ombre légère derrière l'hexagone pour un peu de profondeur
    $shadowOffset = $Size * 0.018
    [System.Drawing.PointF[]]$shadowPoints = $pointsArray | ForEach-Object { New-Object System.Drawing.PointF(($_.X + $shadowOffset), ($_.Y + $shadowOffset)) }
    $shadowBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(60, 0, 0, 0))
    $g.FillPolygon($shadowBrush, $shadowPoints)

    # Hexagone principal (vert Node.js officiel #339933)
    $fillBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 51, 153, 51))
    $g.FillPolygon($fillBrush, $pointsArray)

    # Contour légèrement plus foncé
    $penWidth = [Math]::Max(1.0, $Size * 0.014)
    $outlinePen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 38, 115, 38)), $penWidth
    $g.DrawPolygon($outlinePen, $pointsArray)

    # Glyphe blanc ">_" centré (chevron + underscore = terminal / démarrage)
    $strokeW = $Size * 0.075
    $whitePen = New-Object System.Drawing.Pen ([System.Drawing.Color]::White), $strokeW
    $whitePen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $whitePen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $whitePen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round

    $chevX1 = $cx - $Size * 0.17
    $chevY1 = $cy - $Size * 0.135
    $chevX2 = $cx - $Size * 0.015
    $chevYm = $cy
    $chevX3 = $chevX1
    $chevY3 = $cy + $Size * 0.135

    [System.Drawing.PointF[]]$chevronPoints = @(
        (New-Object System.Drawing.PointF([float]$chevX1, [float]$chevY1)),
        (New-Object System.Drawing.PointF([float]$chevX2, [float]$chevYm)),
        (New-Object System.Drawing.PointF([float]$chevX3, [float]$chevY3))
    )
    $g.DrawLines($whitePen, $chevronPoints)

    $ulX1 = $cx + $Size * 0.01
    $ulX2 = $cx + $Size * 0.175
    $ulY = $cy + $Size * 0.135
    $g.DrawLine($whitePen, [float]$ulX1, [float]$ulY, [float]$ulX2, [float]$ulY)

    $bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)

    $whitePen.Dispose()
    $outlinePen.Dispose()
    $fillBrush.Dispose()
    $shadowBrush.Dispose()
    $g.Dispose()
    $bmp.Dispose()
}

$assets = "C:\Users\loic\Documents\GitHub\NodeStart\assets"
$build = "C:\Users\loic\Documents\GitHub\NodeStart\build"

New-NodeStartLogo -Size 1024 -OutPath (Join-Path $assets "logo-large.png")
New-NodeStartLogo -Size 512  -OutPath (Join-Path $assets "logo-medium.png")
New-NodeStartLogo -Size 256  -OutPath (Join-Path $assets "logo-small.png")

# Icône Windows (.ico) dérivée de la version 256px, pour l'installeur et la barre des tâches.
$srcBmp = New-Object System.Drawing.Bitmap (Join-Path $assets "logo-small.png")
$hIcon = $srcBmp.GetHicon()
$icon = [System.Drawing.Icon]::FromHandle($hIcon)
$fs = New-Object System.IO.FileStream((Join-Path $build "icon.ico"), [System.IO.FileMode]::Create)
$icon.Save($fs)
$fs.Close()
$icon.Dispose()
$srcBmp.Dispose()

"Logo généré : logo-large.png (1024px), logo-medium.png (512px), logo-small.png (256px), icon.ico"
