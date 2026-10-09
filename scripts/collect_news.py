"""Low-cost collector: official news + dated events + reusable editorial ideas.
No model calls, credentials or user data. Never stamp old articles as new.
"""
import json, re, hashlib, html
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.parse import urljoin, quote
from zoneinfo import ZoneInfo
from concurrent.futures import ThreadPoolExecutor
import feedparser
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
NOW = datetime.now(timezone.utc)
TODAY = NOW.astimezone(ZoneInfo('Europe/Madrid')).date()

def fetch(url):
    with urlopen(Request(url, headers={'User-Agent':'ContentCommandCenter/1.0'}), timeout=25) as response:
        return response.read()

def clean(text):
    return re.sub(r'\s+', ' ', BeautifulSoup(text or '', 'html.parser').get_text(' ', strip=True)).strip()

def city(text):
    return re.sub(r'\bBarcelona\b', 'Барселона', text, flags=re.I)

def row(title, url, kind, tag, summary, **extra):
    return dict(id=hashlib.sha256(url.encode()).hexdigest()[:16], title=city(title), url=url,
                kind=kind, tag=tag, summary=summary, collectedAt=NOW.isoformat(), **extra)

def news():
    result=[]
    feed=feedparser.parse(fetch('https://ajuntament.barcelona.cat/premsa/feed/'))
    if not feed.entries: raise ValueError('Official news feed has no entries')
    for item in feed.entries:
        date=item.get('published_parsed')
        if not date: continue
        published=datetime(*date[:6],tzinfo=timezone.utc)
        if not NOW-timedelta(days=3)<=published<=NOW+timedelta(hours=2): continue
        title=clean(item.title)
        # Administrative meeting notices are not useful content proposals.
        if re.search(r'sessió|convocatòria.*premsa|agenda.*alcalde|lliura.*medalla|participa.*acte|expliquen novetats',title,re.I): continue
        # Short-lived notices and explicit past event dates must not look current.
        months=['gener','febrer','març','abril','maig','juny','juliol','agost','setembre','octubre','novembre','desembre']
        dated=re.findall(r'(\d{1,2})\s+d[’\x27e ]+('+ '|'.join(months)+r')',title.lower())
        if dated:
            try:
                if all(datetime(TODAY.year,months.index(m)+1,int(d)).date()<TODAY for d,m in dated): continue
            except ValueError: continue
        if re.search(r'emergència|alerta|insuficiència|aturades|alteracions',title,re.I) and published<NOW-timedelta(hours=24): continue
        summary='Новина от общината, публикувана на '+published.strftime('%d.%m.%Y')+'. '+city(clean(item.get('summary','')))[:500]+' Провери подробностите и дали има по-ново съобщение преди създаване на пост.'
        result.append(row(title,item.link,'news','Барселона',summary,
                          publishedAt=published.isoformat(),source='Ajuntament de Barcelona'))
    return result

def property_news():
    query='Barcelona vivienda alquiler compra (site:habitatge.barcelona OR site:govern.cat) when:3d'
    feed=feedparser.parse(fetch('https://news.google.com/rss/search?q='+quote(query)+'&hl=es&gl=ES&ceid=ES:es'))
    out=[]
    for item in feed.entries[:15]:
        stamp=item.get('published_parsed')
        if not stamp: continue
        published=datetime(*stamp[:6],tzinfo=timezone.utc)
        if not NOW-timedelta(days=3)<=published<=NOW+timedelta(hours=2): continue
        out.append(row(clean(item.title),item.link,'news','Имоти','Тема за проверка от официален източник. Провери датата на промяната и приложимостта за купувачи преди публикуване.',publishedAt=published.isoformat(),source=clean(item.get('source',{}).get('title','Google News'))))
    return out

def events():
    base='https://guia.barcelona.cat/es/'
    soup=BeautifulSoup(fetch(base),'html.parser')
    result=[]
    for card in soup.select('.content-ag'):
        a=card.select_one('h3 a')
        if not a: continue
        dates=[]
        where=''
        for label in card.select('dt'):
            value=label.find_next_sibling('dd')
            if not value: continue
            if 'Cuándo' in label.get_text(): dates=re.findall(r'\d{2}/\d{2}/\d{4}',value.get_text())
            if 'Dónde' in label.get_text(): where=value.get_text(' ',strip=True)
        if not dates: continue  # Never invent an event date from collection time.
        start=datetime.strptime(dates[0],'%d/%m/%Y').date()
        end=datetime.strptime(dates[-1],'%d/%m/%Y').date()
        if end<TODAY or start>TODAY+timedelta(days=45): continue
        url=urljoin(base,a['href'])
        summary=f'Събитие: {dates[0]}'+(f' – {dates[-1]}' if len(dates)>1 else '')+f'. Място: {city(where)}. '+city(clean(str(card.select_one('.resum') or '')))+ ' Провери часовете, билетите и възрастовите ограничения в официалната програма.'
        result.append(row(a.get_text(' ',strip=True),url,'event','Събития',summary,
                          eventStart=start.isoformat(),eventEnd=end.isoformat(),
                          key='event|'+url+'|'+start.isoformat(),source='Guia BCN — официална програма'))
    if not result: raise ValueError('No current dated events parsed')
    return result

# Editorial proposals, not claims of breaking news. Prices/rules are verified at post creation.
EVERGREEN=[
 ('transport-choice','Коя транспортна карта ти трябва за уикенд в Барселона?','Туризъм','Сравнение според броя пътувания, хората и маршрута. Провери актуалните цени и условия преди публикуване.','https://static-web.tmb.cat/es/tarifas-metro-bus-barcelona'),
 ('airport-metro','От летището до хотела: как да планираш маршрута с метро','Туризъм','Практичен пример с L9 Sud, прекачване и подходящ билет. Провери конкретния хотел, действащите маршрути и условията за летището.','https://www.tmb.cat/es/visita-barcelona/transporte-publico/metro-aeropuerto'),
 ('casual-mistakes','T-casual: какво да провериш, преди да купиш карта','Туризъм','Идея за кратък списък: за кого е картата, зони, валидност и летищни изключения. Без непроверени цени.','https://static-web.tmb.cat/es/tarifas-metro-bus-barcelona/t-casual'),
 ('ciutadella-details','Разходка из Parc de la Ciutadella: детайли, които лесно пропускаш','Семейство','Маршрут около каскадата, езерото и скулптурите. Провери достъпа и текущите ограничения преди препоръка.','https://www.barcelona.cat/es/que-hacer-en-bcn/parques-y-jardines/parc-de-la-ciutadella-92086011921'),
 ('guinardo-gardens','По-тиха разходка: Jardins del Doctor Pla i Armengol','Барселона','Идея за квартална разходка с практичен маршрут, входове и подходящо време. Провери работното време.','https://guia.barcelona.cat/ca/detall/jardins-del-doctor-pla-i-armengol_99400643473.html'),
 ('accessible-diagonal','Разходка с количка в Parc Diagonal Mar: как да планираш маршрута','Семейство','Използвай официалния достъпен маршрут като отправна точка и провери текущите ремонти и достъп.','https://bcnroc.ajuntament.barcelona.cat/jspui/handle/11703/139636'),
 ('own-agenda','Как да намираш събития в своя квартал в Барселона','Общност','Покажи как се търси по дата, квартал и цена в официалната програма; практично ръководство с пример.','https://guia.barcelona.cat/'),
 ('joan-miro','Parc de Joan Miró: идея за кратка квартална разходка','Барселона','Пост за парка и пространствата за почивка. Провери работното време и подходящия маршрут.','https://www.barcelona.cat/ca/que-pots-fer-a-bcn/parcs-i-jardins/parc-de-joan-miro_92086012013.html'),
]

def evergreen():
    return [row(title,url,'evergreen',tag,'Тема без срок: '+summary,key='evergreen|'+key,source='Редакционна идея — официален източник') for key,title,tag,summary,url in EVERGREEN]

def valid(item):
    try:
        if item.get('kind')=='evergreen': return True
        if item.get('kind')=='event': return datetime.fromisoformat(item['eventEnd']).date()>=TODAY
        date=datetime.fromisoformat(item['publishedAt'])
        return NOW-timedelta(days=3)<=date<=NOW+timedelta(hours=2)
    except (ValueError,KeyError,TypeError): return False

def collect():
    path=ROOT/'data/news.json'
    old=json.loads(path.read_text()) if path.exists() else []
    output=[];failures=[]
    with ThreadPoolExecutor(max_workers=3) as pool:
        jobs={pool.submit(fn):kind for fn,kind in [(news,'news'),(events,'event'),(property_news,'property')]}
        for future,kind in jobs.items():
            try: output.extend(future.result())
            except Exception as exc:
                failures.append(kind+': '+str(exc))
                output.extend(i for i in old if (i.get('tag')=='Имоти' if kind=='property' else i.get('kind')==kind and i.get('tag')!='Имоти') and valid(i))
    output.extend(evergreen())
    # Preserve reviewed Bulgarian wording only for the same article/event edition.
    reviewed={i.get('key',i['url']):i for i in old if i.get('editorialReviewed')}
    for item in output:
        previous=reviewed.get(item.get('key',item['url']))
        if previous and previous.get('publishedAt')==item.get('publishedAt'):
            for field in ['title','summary','editorialReviewed']: item[field]=previous[field]
    seen=set();unique=[]
    for item in output:
        key=item.get('key',item['url'])
        if key not in seen: unique.append(item);seen.add(key)
    path.parent.mkdir(exist_ok=True)
    path.write_text(json.dumps(unique,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'counts':{kind:sum(i['kind']==kind for i in unique) for kind in ['news','event','evergreen']},'warnings':failures},ensure_ascii=False))
    for failure in failures: print('::warning::'+failure)
    if len(failures)==3: raise SystemExit(1)

if __name__=='__main__': collect()
