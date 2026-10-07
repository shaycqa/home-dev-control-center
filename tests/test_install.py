import shutil, contextlib, importlib.util, io, json, os, pathlib, subprocess, sys, tempfile, unittest
from unittest.mock import patch
SCRIPTS = pathlib.Path(__file__).resolve().parent.parent / 'scripts'
sys.path.insert(0, str(SCRIPTS))
import bootstrap, service
spec = importlib.util.spec_from_file_location('private_access', SCRIPTS / 'configure-private-access.py')
access = importlib.util.module_from_spec(spec); spec.loader.exec_module(access)
spec = importlib.util.spec_from_file_location('remove_access', SCRIPTS / 'remove-private-access.py')
remove = importlib.util.module_from_spec(spec); spec.loader.exec_module(remove)

class InstallTests(unittest.TestCase):
 def setUp(self):
  self.temp = tempfile.TemporaryDirectory(prefix='hdc-install-'); self.addCleanup(self.temp.cleanup)
  self.root = pathlib.Path(self.temp.name)
  self.env = patch.dict(os.environ, {'HOME':str(self.root),'HDC_CONFIG_DIR':str(self.root/'config'),'HDC_DATA_DIR':str(self.root/'data')});self.env.start();self.addCleanup(self.env.stop)
 def bootstrap(self):
  with patch.object(sys,'argv',['bootstrap','--user','developer@example.test','--root',str(self.root/'projects'),'--port','18443']), contextlib.redirect_stdout(io.StringIO()): bootstrap.main()
 def test_bootstrap_and_unit_portability(self):
  self.bootstrap(); config,data=bootstrap.locations(); file=config/'config.json'; value=json.loads(file.read_text())
  self.assertEqual(value['allowedUsers'],['developer@example.test']); self.assertEqual(value['port'],18443); self.assertGreaterEqual(len(value['accessKey']),40)
  self.assertEqual(file.stat().st_mode & 0o777,0o600)
  self.bootstrap();self.assertEqual(json.loads(file.read_text())['accessKey'],value['accessKey'])
  dest=self.root/'test.service'
  with patch.object(sys,'argv',['service',str(self.root/'checkout with spaces'),shutil.which('node'),str(dest)]):service.main()
  text=dest.read_text();self.assertNotIn('@SOURCE@',text);self.assertIn('18443',file.read_text());self.assertIn('HDC_CONFIG_DIR='+str(config),text)
  result=subprocess.run(['systemd-analyze','verify',str(dest)],capture_output=True,text=True)
  self.assertEqual(result.returncode,0,result.stderr)
 def test_serve_conflict_and_owned_route_removal(self):
  self.bootstrap();config,data=bootstrap.locations()
  status={'BackendState':'Running','Self':{'DNSName':'machine.example.ts.net.'}}
  unrelated={'Web':{'machine.example.ts.net:443':{'Handlers':{'/':{'Proxy':'http://127.0.0.1:19999'}}}}}
  with patch.object(sys,'argv',['serve','--no-restart']),patch.object(access,'run',side_effect=[json.dumps(status),json.dumps(unrelated)]),patch.object(access.subprocess,'run') as execute:
   with self.assertRaises(SystemExit):access.main()
   execute.assert_not_called()
  previous={'Web':{'machine.example.ts.net:8443':{'Handlers':{'/':{'Proxy':'http://127.0.0.1:19999'}}}}}
  with patch.object(sys,'argv',['serve','--no-restart']),patch.object(access,'run',side_effect=[json.dumps(status),json.dumps(previous)]),patch.object(access.subprocess,'run') as execute,contextlib.redirect_stdout(io.StringIO()):
   access.main();self.assertIn('--bg',execute.call_args.args[0]);self.assertIn('http://127.0.0.1:18443',execute.call_args.args[0]);self.assertIn('--https=443',execute.call_args.args[0])
  current={'Web':{'machine.example.ts.net:443':{'Handlers':{'/':{'Proxy':'http://127.0.0.1:18443'},'/other':{'Proxy':'http://127.0.0.1:19999'}}},**previous['Web']}}
  with patch.object(remove.subprocess,'check_output',return_value=json.dumps(current)),patch.object(remove.subprocess,'run') as execute:
   remove.main();self.assertEqual(execute.call_count,1);self.assertIn('--set-path=/',execute.call_args.args[0]);self.assertIn('--https=443',execute.call_args.args[0])
 def test_backup_is_private_and_separate(self):
  self.bootstrap()
  result=subprocess.run(['bash',str(SCRIPTS/'backup.sh')],check=True,capture_output=True,text=True)
  archive=pathlib.Path(result.stdout.strip().split(': ',1)[1]);self.assertTrue(archive.exists());self.assertEqual(archive.stat().st_mode&0o777,0o600)

if __name__ == '__main__': unittest.main()
