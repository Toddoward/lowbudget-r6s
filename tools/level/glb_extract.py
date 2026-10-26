import json,struct,numpy as np,sys
import sys
b=open(sys.argv[1] if len(sys.argv) > 1 else 'house_map.glb','rb').read()
L=struct.unpack('<I',b[12:16])[0]
j=json.loads(b[20:20+L])
off=20+L
L2=struct.unpack('<I',b[off:off+4])[0]
bin_=b[off+8:off+8+L2]
CT={5126:'f4',5125:'u4',5123:'u2',5121:'u1'}
NC={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}
def acc(i):
    a=j['accessors'][i]; bv=j['bufferViews'][a['bufferView']]
    o=bv.get('byteOffset',0)+a.get('byteOffset',0)
    n=a['count']*NC[a['type']]
    arr=np.frombuffer(bin_,dtype=CT[a['componentType']],count=n,offset=o)
    stride=bv.get('byteStride')
    if stride and stride!=np.dtype(CT[a['componentType']]).itemsize*NC[a['type']]:
        raise Exception('stride')
    return arr.reshape(-1,NC[a['type']]) if NC[a['type']]>1 else arr
def M(n):
    if 'matrix' in n: return np.array(n['matrix']).reshape(4,4).T
    m=np.eye(4)
    return m
out={}
# walk from Root (node 1) with floor-local transforms: keep the floor node matrix (scale + offset), skip Sketchfab root (Z-up -> Y-up)
def walk(i,mat,floor):
    n=j['nodes'][i]; m=mat@M(n)
    if n.get('name') in ('1F','2F','B1'): floor=n['name']
    if 'mesh' in n:
        for p in j['meshes'][n['mesh']]['primitives']:
            pos=acc(p['attributes']['POSITION']).astype(float)
            idx=acc(p['indices']).astype(int).reshape(-1,3)
            P=(m@np.c_[pos,np.ones(len(pos))].T).T[:,:3]
            out[n['name']]={'floor':floor,'mat':j['materials'][p['material']]['name'],'tris':P[idx].tolist()}
    for c in n.get('children',[]): walk(c,m,floor)
walk(1,np.eye(4),None)
json.dump(out,open('tris.json','w'))
for k,v in out.items():
    t=np.array(v['tris']); print(k,v['floor'],v['mat'],len(t),'min',t.reshape(-1,3).min(0).round(3),'max',t.reshape(-1,3).max(0).round(3))
