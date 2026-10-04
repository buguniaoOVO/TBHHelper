from pathlib import Path
import argparse, subprocess

args = argparse.ArgumentParser()
args.add_argument('--java', required=True)
args.add_argument('--base', required=True)
options = args.parse_args()
root = Path(__file__).resolve().parent.parent
output = root / 'build/contract-checks'
output.mkdir(parents=True, exist_ok=True)
fixture = output / 'plugin-fill-status.tsv'
subprocess.run(['dotnet', 'run', '--project', str(root/'tests/RegressionChecks.csproj'), '-c', 'Release', '--', str(fixture)], check=True)
sources = ['src/java/com/lulu/api/CubeFillStatus.java', 'src/java/com/lulu/api/PluginCompatibility.java',
           'src/java/com/lulu/api/BridgeEndpoint.java', 'src/java/com/lulu/core/PluginDeployment.java',
           'src/java/com/lulu/core/CorrosionTiming.java', 'src/java/com/lulu/logic/monitor/PeriodicSchedule.java', 'tests/ProtocolChecks.java']
subprocess.run([options.java, '-jar', str(root/'tools/ecj.jar'), '-encoding', 'UTF-8', '-source', '8', '-target', '8',
                '-cp', options.base, '-d', str(output)] + [str(root/p) for p in sources], check=True)
subprocess.run([options.java, '-cp', str(output), 'ProtocolChecks', str(fixture)], check=True)
