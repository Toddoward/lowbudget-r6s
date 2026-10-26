import json,matplotlib,numpy as np
matplotlib.use('Agg')
import matplotlib.pyplot as plt
S=2.85
R=json.load(open('faces.json')); T=json.load(open('tris.json'))
def box(name):
    t=np.array(T[name]['tris']).reshape(-1,3); return t.min(0),t.max(0)
import sys
fl=sys.argv[1]
fig,ax=plt.subplots(figsize=(22,16))
for k,p in enumerate(R[fl]['pieces']):
    col='red' if p['src']==['soft','soft'] else ('orange' if 'soft' in p['src'] else '#333')
    if p['o']=='h':  # const model y -> const z
        x0,x1=p['a']*S,p['b']*S; z0,z1=-p['c1']*S,-p['c0']*S
    else:
        x0,x1=p['c0']*S,p['c1']*S; z0,z1=-p['b']*S,-p['a']*S
    ax.add_patch(plt.Rectangle((x0,z0),x1-x0,z1-z0,fc=col,ec='none'))
    ax.text((x0+x1)/2,(z0+z1)/2,str(k),fontsize=7,color='blue',ha='center',va='center')
for p,q,n,s in R[fl]['diag']: ax.plot([p[0]*S,q[0]*S],[-p[1]*S,-q[1]*S],color='green',lw=1.5)
for name,v in T.items():
    if v['floor']!=fl or name.endswith(('_0','_1')) and name.startswith(fl): continue
    mn,mx=box(name)
    col={'barricade':'gold','hard_barricade':'saddlebrown','Material.001':'dodgerblue','None':'purple'}[v['mat']]
    if v['mat']=='barricade':
        # components
        t=np.array(v['tris'])
        for i in range(0,len(t),12):
            c=t[i:i+12].reshape(-1,3); a,b=c.min(0),c.max(0)
            ax.add_patch(plt.Rectangle((a[0]*S,-b[1]*S),(b[0]-a[0])*S,(b[1]-a[1])*S,fc='gold',ec='k',lw=0.5))
            ax.text((a[0]+b[0])/2*S,-(a[1]+b[1])/2*S+0.3,'%.2f'%((a[2])),fontsize=6)
    else:
        ax.add_patch(plt.Rectangle((mn[0]*S,-mx[1]*S),(mx[0]-mn[0])*S,(mx[1]-mn[1])*S,fill=False,ec=col,lw=1.5))
        ax.text(mn[0]*S,-mn[1]*S,name,fontsize=8,color=col)
ax.set_aspect('equal'); ax.set_xlim(-11,10.5); ax.set_ylim(8,-8)
ax.set_xticks(np.arange(-11,10.6,1)); ax.set_yticks(np.arange(-8,8.1,1))
ax.set_xticks(np.arange(-11,10.6,0.25),minor=True); ax.set_yticks(np.arange(-8,8.1,0.25),minor=True)
ax.grid(lw=0.6); ax.grid(which='minor',lw=0.15); ax.set_title(fl+' (game coords: +X east, +Z south; north up)')
ax.set_xlabel('X (m)'); ax.set_ylabel('Z (m)')
fig.savefig(f'real_{fl}.png',dpi=55,bbox_inches='tight')
