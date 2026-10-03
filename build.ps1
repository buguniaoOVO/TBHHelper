param(
    [Parameter(Mandatory=$true)][string]$BaseApp,
    [string]$JavaPath,
    [string]$PythonPath='python',
    [string]$GameDir,
    [switch]$IncludePlugin
)
$ErrorActionPreference='Stop'
$tbhRoot=$PSScriptRoot
$tbhBase=(Resolve-Path -LiteralPath $BaseApp).Path
if(-not $JavaPath){$JavaPath=Join-Path (Split-Path -Parent $tbhBase) 'jre\bin\java.exe'}
if(-not(Test-Path -LiteralPath $JavaPath)){throw '请用-JavaPath指定Java 17或更高的java.exe'}
$tbhClasses=Join-Path $tbhRoot 'build\classes'
$tbhNative=Join-Path $tbhRoot 'build\native'
New-Item -ItemType Directory -Path $tbhClasses,$tbhNative,(Join-Path $tbhRoot 'dist') -Force | Out-Null
$tbhNames=@('MainGUI','api\DllApiClient','api\MonitorStatus','config\Config','core\DeployManager','gui\DesktopSupport','gui\I18n','gui\UiPreferences','gui\ModernUI','gui\NavigationIcon','logic\monitor\ActivityStore','logic\monitor\StatsManager','logic\tasks\ChestTask','logic\tasks\CorrosionTask','logic\tasks\EquipmentSynthesisTask','logic\tasks\MaterialSynthesisTask','logic\tasks\SynthesisRunner','logic\tasks\PlaguelandsTask','logic\tasks\StoreTask','warehouse\MarketPriceClient','warehouse\WarehouseModel','warehouse\WarehousePanel')
$tbhSources=@($tbhNames | ForEach-Object {Join-Path $tbhRoot ('src\java\com\lulu\'+$_+'.java')})
& $JavaPath '-Dfile.encoding=UTF-8' -jar (Join-Path $tbhRoot 'tools\ecj.jar') -encoding UTF-8 -source 8 -target 8 -cp $tbhBase -d $tbhClasses @tbhSources
if($LASTEXITCODE -ne 0){throw 'Java compilation failed'}
$tbhCsc=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $tbhCsc /nologo /target:winexe /platform:x64 /optimize+ /codepage:65001 ('/win32icon:'+(Join-Path $tbhRoot 'resources\imgs\tbh-helper.ico')) ('/win32manifest:'+(Join-Path $tbhRoot 'src\launcher\TbhBootstrap.manifest')) ('/out:'+(Join-Path $tbhNative 'TBH助手.exe')) /reference:System.Windows.Forms.dll (Join-Path $tbhRoot 'src\launcher\TbhBootstrap.cs')
if($LASTEXITCODE -ne 0){throw 'Native launcher compilation failed'}
& $PythonPath (Join-Path $tbhRoot 'tools\package_app.py') --base $tbhBase
if($LASTEXITCODE -ne 0){throw 'Package creation failed'}
if($IncludePlugin){
    if(-not $GameDir){throw '编译插件需要-GameDir，且游戏应已生成BepInEx interop程序集'}
    & dotnet build (Join-Path $tbhRoot 'src\plugin\TBHPlugin.csproj') -c Release ('-p:GameDir='+$GameDir)
    if($LASTEXITCODE -ne 0){throw 'Plugin compilation failed'}
}
