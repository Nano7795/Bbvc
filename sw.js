// sw.js - service worker
self.addEventListener('install', e=>{
  self.skipWaiting();
});

self.addEventListener('activate', e=>{
  clients.claim();
});

// Helper to post logs to pages (optional)
async function notifyClients(msg){
  const all = await clients.matchAll({includeUncontrolled:true});
  for(const c of all) c.postMessage(msg);
}

// Attempt to schedule using showTrigger if available
async function scheduleUsingTrigger(id, title, timestamp, data){
  try{
    // TimestampTrigger / showTrigger is not universally available.
    // feature-detect
    if(typeof self.registration.showNotification === 'function' && typeof TimestampTrigger !== 'undefined'){
      await self.registration.showNotification(title, {
        body: data || '',
        tag: id,
        showTrigger: new TimestampTrigger(timestamp),
        renotify: true
      });
      return true;
    }
  }catch(e){
    console.warn('trigger schedule failed', e);
  }
  return false;
}

// Simple immediate notification helper
function showNow(title, body, tag){
  return self.registration.showNotification(title, { body: body||'', tag: tag||undefined });
}

// Message handler from page
self.addEventListener('message', event=>{
  const msg = event.data;
  if(!msg) return;
  if(msg.type === 'schedule-date'){
    const sch = msg.schedule;
    // compute timestamp
    const [hh,mm] = sch.time.split(':').map(x=>parseInt(x));
    const parts = sch.date.split('-'); // YYYY-MM-DD
    const dt = new Date(parseInt(parts[0]), parseInt(parts[1])-1, parseInt(parts[2]), hh, mm, 0, 0);
    const ts = dt.getTime();
    // try trigger
    scheduleUsingTrigger(sch.id, sch.text || 'Reminder', ts, sch.text).then(ok=>{
      if(!ok){
        // if unsupported, store in indexedDB or let page fallback
        // we'll notify clients that trigger unsupported
        notifyClients({type:'no-trigger', id:sch.id});
      }
    });
  } else if(msg.type === 'schedule-weekday'){
    // scheduling weekly with triggers needs multiple TimestampTriggers (one per day)
    const sch = msg.schedule;
    const now = new Date();
    sch.days.forEach(d=>{
      // compute next occurrence date
      let candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const [hh,mm] = sch.time.split(':').map(x=>parseInt(x));
      candidate.setHours(hh,mm,0,0);
      let diff = d - now.getDay();
      if(diff < 0) diff += 7;
      if(diff === 0 && candidate <= now){
        diff = 7;
      }
      candidate.setDate(candidate.getDate() + diff);
      scheduleUsingTrigger(sch.id+'_'+d, sch.text || 'Reminder', candidate.getTime(), sch.text).then(ok=>{
        if(!ok) notifyClients({type:'no-trigger', id:sch.id});
      });
    });
  } else if(msg.type === 'restore'){
    // try restore all scheduled on activation
    const list = msg.schedules || [];
    list.forEach(sch=>{
      if(sch.type === 'date') self.registration.active && self.registration.active.postMessage({type:'restore-date', schedule:sch});
      else self.registration.active && self.registration.active.postMessage({type:'restore-weekday', schedule:sch});
    });
  } else if(msg.type === 'cancel'){
    // can't easily cancel a TimestampTrigger in many implementations; browser may support getNotifications to clear by tag
    self.registration.getNotifications({tag: msg.id}).then(nots=>{
      nots.forEach(n=>n.close());
    });
  }
});

self.addEventListener('notificationclick', function(ev){
  ev.notification.close();
  ev.waitUntil(clients.matchAll({type:'window'}).then(list=>{
    if(list.length>0) return list[0].focus();
    return clients.openWindow('/');
  }));
});
