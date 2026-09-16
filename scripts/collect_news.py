import json, re, time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote
import feedparser

MAX_AGE_DAYS=7
QUERIES=[('Барселона','Barcelona novedades OR cambios site:barcelona.cat'),('Събития','Barcelona agenda eventos cultura'),('Имоти','Barcelona vivienda alquiler compra Generalitat Catalunya'),('Туризъм','Barcelona turismo entradas transporte visitantes'),('NIE и документи','Barcelona extranjeria NIE tramites'),('Семейство','Barcelona familias niños actividades')]
def clean(value): return re.sub(r'<[^>]+>','',value or '').strip()
def collect():
    output,seen=[],set()
    now=datetime.now(timezone.utc)
    cutoff=now-timedelta(days=MAX_AGE_DAYS)
    for tag,query in QUERIES:
        url=f'https://news.google.com/rss/search?q={quote(query + f" when:{MAX_AGE_DAYS}d")}&hl=es&gl=ES&ceid=ES:es'
        for entry in feedparser.parse(url).entries[:8]:
            published=entry.get('published_parsed')
            if not published: continue
            published_at=datetime(*published[:6],tzinfo=timezone.utc)
            if published_at<cutoff or published_at>now+timedelta(hours=2): continue
            link,title=entry.get('link',''),clean(entry.get('title',''))
            key=re.sub(r'\W','',title.lower())[:90]
            if not title or key in seen: continue
            seen.add(key);source=clean(entry.get('source',{}).get('title','')) or 'Google News'
            output.append({'id':int(time.time()*1000)+len(output),'title':title,'summary':f'Нова публикация от {source}. Отвори източника и провери фактите преди одобрение.','tag':tag,'source':source,'url':link,'age':'нова','score':86 if tag in ('Барселона','Имоти') else 80,'urgent':8 if tag=='Събития' else 6,'publishedAt':published_at.isoformat(),'collectedAt':now.isoformat()})
    return output[:40]
path=Path(__file__).parents[1]/'data'/'news.json';path.parent.mkdir(exist_ok=True);path.write_text(json.dumps(collect(),ensure_ascii=False,indent=2),encoding='utf-8')
