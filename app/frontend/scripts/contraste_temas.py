"""Contraste WCAG de los temas de Caudal (claro y oscuro). Uso: python app/frontend/scripts/contraste_temas.py"""
import re,sys
s=re.sub(r'/\*.*?\*/','',open(__import__('pathlib').Path(__file__).resolve().parents[1] / 'src/styles/tokens.css',encoding='utf-8').read(),flags=re.S)
bloques=re.findall(r'([^{}]+)\{([^{}]*)\}',s)
def props(cuerpo): return dict(re.findall(r'--([\w-]+):\s*([^;]+);',cuerpo))
sel={}
for selector,cuerpo in bloques:
    selector=' '.join(selector.split()).strip()
    sel.setdefault(selector,{}).update(props(cuerpo))
base_claro={}; base_claro.update(sel.get(':root, [data-theme="light"]',{})); base_claro.update(sel.get(':root',{}))
oscuro=dict(base_claro); oscuro.update(sel.get('[data-theme="dark"]',{}))
def tema(t,modo):
    d=dict(base_claro if modo=='claro' else oscuro)
    if t!='verde':
        d.update(sel.get(f'[data-acento="{t}"]',{}))
        if modo=='oscuro': d.update(sel.get(f'[data-theme="dark"][data-acento="{t}"]',{}))
    return d
def resolver(d,v,n=0):
    v=v.strip()
    m=re.fullmatch(r'var\(--([\w-]+)\)',v)
    if m and n<10: return resolver(d,d[m.group(1)],n+1)
    return v
def rgb(h):
    h=h.lstrip('#'); return [int(h[i:i+2],16)/255 for i in (0,2,4)]
def lum(c):
    c=[x/12.92 if x<=0.03928 else ((x+0.055)/1.055)**2.4 for x in c]
    return 0.2126*c[0]+0.7152*c[1]+0.0722*c[2]
def ratio(a,b):
    la,lb=lum(rgb(a)),lum(rgb(b)); return (max(la,lb)+0.05)/(min(la,lb)+0.05)
pares=[('ink','card',4.5),('ink-muted','card',4.5),('ink-subtle','card',3),('ink-muted','surface',4.5),('link','card',4.5),('accent-ink','card',4.5),
 ('on-brand','brand',4.5),('on-accent','accent',4.5),('on-nav-active','nav-active',4.5),('on-brand-soft','brand-soft',4.5),
 ('positive','card',4.5),('negative','card',4.5),('warning','card',4.5),('focus-ring','card',3),('chart-1','chart-track',3)]
fallos=0
for t in ['verde','mandarina','azul','violeta','menta','grises','vinotinto','amarillo','negro','rosado','crema','terracota','oceano','lavanda','bosque','cielo','coral','ciruela']:
    for modo in ['claro','oscuro']:
        d=tema(t,modo); malos=[]
        for a,b,minimo in pares:
            va,vb=resolver(d,d[a]),resolver(d,d[b])
            if not va.startswith('#') or not vb.startswith('#'): continue
            r=ratio(va,vb)
            if r<minimo: malos.append(f'{a}/{b} {r:.2f} (<{minimo})')
        fallos+=len(malos)
        print(f'{t:9} {modo:6}', 'OK' if not malos else '; '.join(malos))
print('fallos',fallos)
peores=[]
for t in ['verde','mandarina','azul','violeta','menta','grises','vinotinto','amarillo','negro','rosado','crema','terracota','oceano','lavanda','bosque','cielo','coral','ciruela']:
    for modo in ['claro','oscuro']:
        d=tema(t,modo)
        for a,b,minimo in pares:
            va,vb=resolver(d,d[a]),resolver(d,d[b])
            if va.startswith('#') and vb.startswith('#'): peores.append((ratio(va,vb)/minimo,f'{t} {modo} {a}/{b} {ratio(va,vb):.2f}'))
            else: peores.append((99,f'{t} {modo} {a}/{b} sin medir ({va[:20]})'))
for r,txt in sorted(peores)[:8]: print(txt)
print('sin medir:', sum(1 for r,_ in peores if r==99), 'de', len(peores))
sys.exit(1 if fallos else 0)
