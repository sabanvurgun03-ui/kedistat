#!/usr/bin/env python3
"""KediStat: tek dosya kurulum betiğini (kedistat-install.sh) ve sha256sums'ı üretir.
Kullanım: python3 tools/build.py [--repo sahip/depo]"""
import hashlib, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
repo = 'sabanvurgun03-ui/kedistat'
if '--repo' in sys.argv:
    repo = sys.argv[sys.argv.index('--repo') + 1]
ver = open(os.path.join(ROOT, 'VERSION')).read().strip()
assert re.fullmatch(r'\d+\.\d+\.\d+', ver), 'VERSION biçimi x.y.z olmalı'

parts = []
n = 0
for line in open(os.path.join(ROOT, 'tools/files.map'), encoding='utf-8'):
    line = line.rstrip('\n')
    if not line or line.startswith('#'):
        continue
    src, dst, mode = line.split('\t')
    data = open(os.path.join(ROOT, src), encoding='utf-8').read()
    if not data.endswith('\n'):
        data += '\n'
    n += 1
    mark = 'KEDISTAT_EOF_%d' % n
    assert mark not in data, 'işaret içerikte geçiyor: ' + src
    parts.append('mkdir -p "$(dirname %s)"\ncat > %s.new <<\'%s\'\n%s%s\nchmod %s %s.new\nmv -f %s.new %s\n' % (dst, dst, mark, data, mark, mode, dst, dst, dst))
    parts.append('ok "%s"\n' % dst)

tpl = open(os.path.join(ROOT, 'tools/install.sh.in'), encoding='utf-8').read()
out = tpl.replace('@@VERSION@@', ver).replace('@@REPO@@', repo).replace('@@FILES@@', ''.join(parts))
dst = os.path.join(ROOT, 'kedistat-install.sh')
open(dst, 'w', encoding='utf-8', newline='\n').write(out)
os.chmod(dst, 0o755)
# betik sözdizimi
subprocess.check_call(['sh', '-n', dst])
sha = hashlib.sha256(open(dst, 'rb').read()).hexdigest()
open(os.path.join(ROOT, 'sha256sums'), 'w').write('%s  kedistat-install.sh\n' % sha)
print('kedistat-install.sh', ver, '(%d dosya, %d bayt)' % (n, len(out.encode())))
