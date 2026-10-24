# Baut den Gras-Atlas aus Poly Haven „Grass Medium 01“ (CC0): die fünf Büschel-Bilder im unteren Teil
# der Textur freistellen (nur das größte zusammenhängende Stück, ohne Streifen unter dem Fuß),
# Farbe in die Ränder ausbluten und nebeneinander packen. Aufruf im Ordner mit diff.png, dry_diff.png und
# alpha.png (1k): python3 prepare-grass.py <Ausgabeordner>
import sys, json
import numpy as np
from PIL import Image, ImageFilter
from collections import deque
out=sys.argv[1]
alpha=np.array(Image.open('alpha.png').convert('L'))
srcs={'grass_green':np.array(Image.open('diff.png').convert('RGB')),'grass_dry':np.array(Image.open('dry_diff.png').convert('RGB'))}
boxes=[(196,759,558,926),(598,774,936,884),(25,891,206,1023),(590,882,808,1023),(244,904,512,1023)]
def largest(mask):
    lab=np.zeros(mask.shape,np.int32); best=None; bestn=0; cur=0
    H,W=mask.shape
    for y in range(H):
        for x in range(W):
            if mask[y,x] and not lab[y,x]:
                cur+=1; q=deque([(y,x)]); lab[y,x]=cur; n=0
                while q:
                    yy,xx=q.popleft(); n+=1
                    for dy in (-1,0,1):
                        for dx in (-1,0,1):
                            a,b=yy+dy,xx+dx
                            if 0<=a<H and 0<=b<W and mask[a,b] and not lab[a,b]:
                                lab[a,b]=cur; q.append((a,b))
                if n>bestn: bestn=n; best=cur
    return lab==best
pieces=[]
for (x0,y0,x1,y1) in boxes:
    a=alpha[y0:y1,x0:x1].astype(np.float32)/255
    keep=largest(a>0.3)
    rows=keep.sum(axis=1)
    base=max(i for i,r in enumerate(rows) if r>keep.shape[1]*0.12)
    keep[base+3:,:]=False
    km=Image.fromarray((keep*255).astype(np.uint8)).filter(ImageFilter.MaxFilter(5))
    a=a*(np.array(km)>0)
    a[base+3:,:]=0
    ys,xs=np.nonzero(a>0.3)
    t,b,l,r=int(ys.min()),int(ys.max())+1,int(xs.min()),int(xs.max())+1
    pieces.append(((x0+l,y0+t,x0+r,y0+b),a[t:b,l:r]))
pad=6
W=int(sum(p[0][2]-p[0][0] for p in pieces)+pad*(len(pieces)+1))
H=int(max(p[0][3]-p[0][1] for p in pieces)+2*pad)
W2=1<<(W-1).bit_length(); H2=1<<(H-1).bit_length()
rects=[]
for name,rgb in srcs.items():
    atlas=np.zeros((H2,W2,4),np.uint8)
    atlas[...,:3]=np.array([70,80,40],np.uint8)
    x=pad
    for (bx0,by0,bx1,by1),a in pieces:
        w,h=bx1-bx0,by1-by0
        c=rgb[by0:by1,bx0:bx1].astype(np.float32)
        mean=(c*a[...,None]).sum((0,1))/max(a.sum(),1)
        c=c*a[...,None]+mean*(1-a[...,None])
        yb=H2-pad-h
        atlas[yb:yb+h,x:x+w,:3]=c.clip(0,255).astype(np.uint8)
        atlas[yb:yb+h,x:x+w,3]=(a*255).astype(np.uint8)
        if name=='grass_green':
            rects.append([x/W2, 1-(yb+h)/H2, (x+w)/W2, 1-yb/H2, w/h])
        x+=w+pad
    Image.fromarray(atlas,'RGBA').save(f'{out}/{name}.png',optimize=True)
print(W2,H2)
print(json.dumps([[round(v,4) for v in r] for r in rects]))
