import os from 'node:os';
os.networkInterfaces=()=>({lo:[{address:'127.0.0.1',netmask:'255.0.0.0',family:'IPv4',mac:'00:00:00:00:00:00',internal:true,cidr:'127.0.0.1/8'}]});
if(process.env.TM_MEMORY_PROBE==='1')setInterval(()=>console.log(`TM_RSS_KB=${Math.round(process.memoryUsage().rss/1024)}`),100).unref();
