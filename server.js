const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const PORT = process.env.PORT || 3000;
app.use(express.static('public'));
app.get('/health', (_req, res) => res.json({ ok: true, game: 'MATH CHASE' }));

const rooms = new Map();
const COLORS = ['#ff6b6b', '#55a7ff', '#ffd166'];
const MAP = { width: 1200, height: 760 };
const QUESTIONS = [
  { topic:'Geometri', q:'Sebuah persegi memiliki sisi 8 cm. Berapa luasnya?', choices:['16 cm²','32 cm²','64 cm²','48 cm²'], answer:2, explain:'Luas persegi = sisi × sisi = 8 × 8 = 64 cm².' },
  { topic:'Geometri', q:'Persegi panjang memiliki panjang 12 cm dan lebar 5 cm. Berapa kelilingnya?', choices:['17 cm','34 cm','60 cm','24 cm'], answer:1, explain:'Keliling = 2 × (panjang + lebar) = 2 × 17 = 34 cm.' },
  { topic:'Geometri', q:'Segitiga memiliki alas 10 cm dan tinggi 6 cm. Berapa luasnya?', choices:['60 cm²','30 cm²','16 cm²','36 cm²'], answer:1, explain:'Luas segitiga = ½ × alas × tinggi = 30 cm².' },
  { topic:'Geometri', q:'Volume kubus dengan panjang rusuk 4 cm adalah …', choices:['16 cm³','48 cm³','64 cm³','24 cm³'], answer:2, explain:'Volume kubus = sisi³ = 4 × 4 × 4 = 64 cm³.' },
  { topic:'Lingkaran', q:'Lingkaran memiliki jari-jari 7 cm. Berapa diameternya?', choices:['7 cm','14 cm','21 cm','49 cm'], answer:1, explain:'Diameter = 2 × jari-jari = 14 cm.' },
  { topic:'Lingkaran', q:'Jika jari-jari lingkaran 7 cm dan π = 22/7, luasnya adalah …', choices:['44 cm²','154 cm²','308 cm²','49 cm²'], answer:1, explain:'Luas = πr² = 22/7 × 7 × 7 = 154 cm².' },
  { topic:'Lingkaran', q:'Diameter lingkaran 14 cm. Dengan π = 22/7, kelilingnya …', choices:['22 cm','44 cm','88 cm','154 cm'], answer:1, explain:'Keliling = π × diameter = 22/7 × 14 = 44 cm.' },
  { topic:'Lingkaran', q:'Garis dari titik pusat ke tepi lingkaran disebut …', choices:['Diameter','Busur','Jari-jari','Tali busur'], answer:2, explain:'Jari-jari adalah ruas garis dari titik pusat ke lingkaran.' },
  { topic:'Geometri', q:'Balok berukuran 5 × 3 × 2 cm. Volumenya …', choices:['10 cm³','20 cm³','30 cm³','60 cm³'], answer:2, explain:'Volume balok = p × l × t = 5 × 3 × 2 = 30 cm³.' },
  { topic:'Lingkaran', q:'Daerah lingkaran yang dibatasi dua jari-jari dan sebuah busur disebut …', choices:['Tembereng','Juring','Apotema','Tali busur'], answer:1, explain:'Juring adalah daerah yang dibatasi dua jari-jari dan satu busur.' }
];
function code4() { let c; do { c = String(1000 + crypto.randomInt(9000)); } while (rooms.has(c)); return c; }
function publicRoom(room) {
  return { code: room.code, status: room.status, players: [...room.players.values()].map(p => ({ id:p.id, name:p.name, color:p.color, ready:p.ready, role: room.status === 'playing' ? p.role : null })), hostId: room.hostId };
}
function emitRoom(room) { io.to(room.code).emit('room:update', publicRoom(room)); }
function playerRoom(socket) { const code = socket.data.room; return code && rooms.get(code); }
function cleanRoom(room) { if (!room.players.size) rooms.delete(room.code); }
function spawnFor(index) { return [{x:140,y:140},{x:140,y:620},{x:1050,y:380}][index] || {x:100,y:100}; }
function startGame(room) {
  const players = [...room.players.values()];
  const hunterIndex = crypto.randomInt(players.length);
  players.forEach((p,i) => { p.role = i === hunterIndex ? 'hunter' : 'crew'; p.x = spawnFor(i).x; p.y = spawnFor(i).y; p.caught = 0; p.stunnedUntil = 0; p.color = COLORS[i]; });
  room.status = 'playing'; room.startedAt = Date.now(); room.endsAt = Date.now() + 5 * 60 * 1000; room.completed = new Set(); room.lastCapture = 0;
  room.questions = [...QUESTIONS].sort(() => Math.random() - .5).slice(0, 6);
  room.questionIndex = new Map(players.filter(p=>p.role==='crew').map(p=>[p.id,0]));
  room.winner = null;
  io.to(room.code).emit('game:start', { room: publicRoom(room), map: MAP, duration: 300, totalTasks: 6 });
  broadcastState(room);
}
function broadcastState(room) {
  const players = [...room.players.values()].map(p => ({id:p.id,name:p.name,color:p.color,x:p.x,y:p.y,role:p.role,caught:p.caught,stunned:Date.now()<p.stunnedUntil}));
  const crew = [...room.players.values()].filter(p=>p.role==='crew');
  const tasksDone = crew.reduce((sum,p)=>sum+(room.questionIndex.get(p.id)||0),0);
  io.to(room.code).emit('game:state', { players, tasksDone, totalTasks: 6, timeLeft: Math.max(0,Math.ceil((room.endsAt-Date.now())/1000)), lastCapture: room.lastCapture });
}
function finish(room, winner, reason) {
  if (room.status !== 'playing') return;
  room.status = 'finished'; room.winner = winner;
  io.to(room.code).emit('game:over', { winner, reason, players: [...room.players.values()].map(p=>({name:p.name,role:p.role,caught:p.caught})) });
  emitRoom(room);
}
function checkWin(room) {
  const crew = [...room.players.values()].filter(p=>p.role==='crew');
  if (crew.every(p=>(room.questionIndex.get(p.id)||0)>=6)) return finish(room,'crew','Semua soal berhasil diselesaikan!');
  if (crew.every(p=>p.caught>=3)) return finish(room,'hunter','Kedua Crewmate tertangkap 3 kali.');
  if (Date.now()>=room.endsAt) return finish(room,'hunter','Waktu permainan habis.');
}
function safeQuestion(room, p) {
  const idx = room.questionIndex.get(p.id)||0;
  if (idx >= 6) return null;
  const q = room.questions[idx];
  return { index:idx, topic:q.topic, q:q.q, choices:q.choices, explain:q.explain };
}

io.on('connection', socket => {
  socket.on('room:create', ({name}, cb=()=>{}) => {
    name = String(name||'Player').trim().slice(0,16) || 'Player';
    const code = code4();
    const room = {code, status:'lobby', players:new Map(), hostId:socket.id};
    room.players.set(socket.id,{id:socket.id,name,color:COLORS[0],ready:false,role:null,x:100,y:100,caught:0,stunnedUntil:0});
    rooms.set(code,room); socket.join(code); socket.data.room=code;
    cb({ok:true,room:publicRoom(room)}); emitRoom(room);
  });
  socket.on('room:join', ({code,name}, cb=()=>{}) => {
    code=String(code||'').trim(); name=String(name||'Player').trim().slice(0,16)||'Player';
    const room=rooms.get(code);
    if(!room) return cb({ok:false,error:'Room tidak ditemukan. Periksa kode 4 angka.'});
    if(room.status!=='lobby') return cb({ok:false,error:'Permainan di room ini sudah dimulai.'});
    if(room.players.size>=3) return cb({ok:false,error:'Room sudah penuh (3/3 pemain).'});
    const i=room.players.size;
    room.players.set(socket.id,{id:socket.id,name,color:COLORS[i],ready:false,role:null,x:100,y:100,caught:0,stunnedUntil:0});
    socket.join(code); socket.data.room=code;
    cb({ok:true,room:publicRoom(room)}); emitRoom(room);
  });
  socket.on('player:ready', (ready) => { const r=playerRoom(socket); if(!r||r.status!=='lobby')return; const p=r.players.get(socket.id); if(p){p.ready=!!ready;emitRoom(r);} });
  socket.on('room:start', () => { const r=playerRoom(socket); if(!r||r.status!=='lobby')return; if(r.hostId!==socket.id)return socket.emit('notice','Hanya host yang bisa memulai.'); if(r.players.size!==3)return socket.emit('notice','Butuh tepat 3 pemain untuk memulai.'); if([...r.players.values()].some(p=>!p.ready))return socket.emit('notice','Semua pemain harus menekan READY.'); startGame(r); });
  socket.on('player:move', ({x,y}) => {
    const r=playerRoom(socket); if(!r||r.status!=='playing')return; const p=r.players.get(socket.id); if(!p||Date.now()<p.stunnedUntil)return;
    if(!Number.isFinite(x)||!Number.isFinite(y))return;
    const speed=p.role==='hunter'?5.0:4.0; const dx=x-p.x,dy=y-p.y; const d=Math.hypot(dx,dy); if(d>speed*1.7){p.x+=dx/d*speed;p.y+=dy/d*speed;} else {p.x=x;p.y=y;}
    p.x=Math.max(28,Math.min(MAP.width-28,p.x));p.y=Math.max(28,Math.min(MAP.height-28,p.y));
    broadcastState(r);
  });
  socket.on('task:open', (_data,cb=()=>{}) => { const r=playerRoom(socket); const p=r?.players.get(socket.id); if(!r||r.status!=='playing'||!p||p.role!=='crew')return cb({ok:false,error:'Hanya Crewmate yang bisa mengerjakan misi.'}); cb({ok:true,question:safeQuestion(r,p)}); });
  socket.on('task:answer', ({answer},cb=()=>{}) => {
    const r=playerRoom(socket); const p=r?.players.get(socket.id); if(!r||r.status!=='playing'||!p||p.role!=='crew')return cb({ok:false,error:'Misi tidak tersedia.'});
    const idx=r.questionIndex.get(p.id)||0; if(idx>=6)return cb({ok:false,done:true});
    const q=r.questions[idx]; const correct=Number(answer)===q.answer;
    if(correct) r.questionIndex.set(p.id,idx+1);
    cb({ok:true,correct,explain:q.explain,question:safeQuestion(r,p),completed:r.questionIndex.get(p.id)||0});
    broadcastState(r); checkWin(r);
  });
  socket.on('hunter:capture', (_data,cb=()=>{}) => {
    const r=playerRoom(socket); const hunter=r?.players.get(socket.id); if(!r||r.status!=='playing'||!hunter||hunter.role!=='hunter')return cb({ok:false,error:'Aksi hanya untuk Hunter.'});
    if(Date.now()-r.lastCapture<15000)return cb({ok:false,error:'Capture masih cooldown.'});
    const target=[...r.players.values()].filter(p=>p.role==='crew'&&p.caught<3&&Date.now()>=p.stunnedUntil).sort((a,b)=>Math.hypot(a.x-hunter.x,a.y-hunter.y)-Math.hypot(b.x-hunter.x,b.y-hunter.y))[0];
    if(!target||Math.hypot(target.x-hunter.x,target.y-hunter.y)>58)return cb({ok:false,error:'Dekati Crewmate sampai jarak 58 px.'});
    target.caught++;target.stunnedUntil=Date.now()+10000;target.x=target.caught%2?140:140;target.y=target.caught%2?140:620;r.lastCapture=Date.now();
    cb({ok:true,message:`${target.name} tertangkap!`});io.to(r.code).emit('notice',`${target.name} tertangkap! Respawn dalam 10 detik.`);broadcastState(r);checkWin(r);
  });
  socket.on('disconnect',()=>{const r=playerRoom(socket);if(!r)return;r.players.delete(socket.id);if(r.status==='playing')finish(r,'hunter','Pemain terputus. Pertandingan dihentikan.');if(r.hostId===socket.id)r.hostId=r.players.keys().next().value;emitRoom(r);cleanRoom(r);});
});
setInterval(()=>{for(const r of rooms.values())if(r.status==='playing'){broadcastState(r);checkWin(r);}},1000);
server.listen(PORT,()=>console.log(`MATH CHASE running on port ${PORT}`));
