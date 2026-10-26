import json,numpy as np,math
d=json.load(open('tris.json'))
FL={'B1':(-5.109,-4.205),'1F':(-0.399,0.408),'2F':(4.063,4.826)}
def slice_oriented(t,h):
    segs=[]
    for tri in t:
        z=tri[:,2]-h
        if (z>0).all() or (z<0).all(): continue
        pts=[]
        for a,b in ((0,1),(1,2),(2,0)):
            if (z[a]>0)!=(z[b]>0):
                s=z[a]/(z[a]-z[b]); pts.append(tri[a]+(tri[b]-tri[a])*s)
        if len(pts)!=2: continue
        n=np.cross(tri[1]-tri[0],tri[2]-tri[0])[:2]; L=np.linalg.norm(n)
        if L<1e-12: continue
        segs.append((pts[0][:2],pts[1][:2],n/L))
    return segs
def union(iv):
    iv=sorted(iv); out=[]
    for a,b in iv:
        if out and a<=out[-1][1]+2e-3: out[-1][1]=max(out[-1][1],b)
        else: out.append([a,b])
    return out
def walls_from(segs_by_src):
    # group faces: key (axis, normal sign, coord rounded) -> intervals with src
    faces={}
    diag=[]
    for src,segs in segs_by_src.items():
        for p,q,n in segs:
            if abs(n[1])>0.999:   # horizontal face (const y)
                key=('h',int(np.sign(n[1])),round((p[1]+q[1])/2,3),src); faces.setdefault(key,[]).append((min(p[0],q[0]),max(p[0],q[0])))
            elif abs(n[0])>0.999:
                key=('v',int(np.sign(n[0])),round((p[0]+q[0])/2,3),src); faces.setdefault(key,[]).append((min(p[1],q[1]),max(p[1],q[1])))
            else:
                if np.linalg.norm(q-p)>0.02: diag.append((p,q,n,src))
    for k in faces: faces[k]=union(faces[k])
    pieces=[]
    for (ax,sg,c,src),ivs in faces.items():
        if sg!=-1: continue
        # partner faces with +1 normal at c+t
        for (ax2,sg2,c2,src2),ivs2 in faces.items():
            if ax2!=ax or sg2!=1: continue
            t=c2-c
            if not (0.012<t<0.14): continue
            for a,b in ivs:
                for a2,b2 in ivs2:
                    lo,hi=max(a,a2),min(b,b2)
                    if hi-lo>0.01:
                        pieces.append({'o':ax,'c0':c,'c1':c2,'a':lo,'b':hi,'src':[src,src2]})
    # keep the thinnest partner for overlapping spans (remove pieces that contain a thinner piece over same span)
    pieces.sort(key=lambda p:(p['c1']-p['c0']))
    kept=[]
    for p in pieces:
        dup=False
        for k in kept:
            if k['o']==p['o'] and abs(k['c0']-p['c0'])<1e-3 and min(k['b'],p['b'])-max(k['a'],p['a'])>0.005: dup=True; break
            if k['o']==p['o'] and abs(k['c1']-p['c1'])<1e-3 and min(k['b'],p['b'])-max(k['a'],p['a'])>0.005: dup=True; break
        if not dup: kept.append(p)
    return kept,diag
res={}
for fl,(f0,f1) in FL.items():
    h=f0+(f1-f0)*0.6
    segs={'hard':slice_oriented(np.array(d[fl+'_0']['tris']),h),'soft':slice_oriented(np.array(d[fl+'_1']['tris']),h)}
    best=None
    for fh in (1,-1):
        for fs in (1,-1):
            sg={'hard':[(p,q,n*fh) for p,q,n in segs['hard']],'soft':[(p,q,n*fs) for p,q,n in segs['soft']]}
            kept,diag=walls_from(sg)
            if best is None or len(kept)>len(best[0]): best=(kept,diag,fh,fs)
    kept,diag,fh,fs=best
    print(fl,'orientation hard',fh,'soft',fs)
    res[fl]={'pieces':kept,'diag':[(p.tolist(),q.tolist(),n.tolist(),s) for p,q,n,s in diag]}
    print(fl,len(kept),'pieces',len(diag),'diag segs')
json.dump(res,open('faces.json','w'))
