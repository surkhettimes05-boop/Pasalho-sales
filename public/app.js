const app=document.getElementById('app');
const state={token:localStorage.getItem('repToken')||'',rep:JSON.parse(localStorage.getItem('repInfo')||'null'),screen:'home',retailers:[],products:[],orders:[],unpaid:[],selectedRetailer:null,cart:{},search:'',category:'All',config:{whatsappNumber:''},lastOrder:null};
const rs=n=>'Rs '+Number(n||0).toLocaleString('en-IN',{maximumFractionDigits:2});
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(url,opt={}){const headers={'Content-Type':'application/json',...(opt.headers||{})};if(state.token)headers.Authorization='Bearer '+state.token;const r=await fetch(url,{...opt,headers});const data=await r.json().catch(()=>({}));if(r.status===401&&state.token){logout();throw new Error('Session expired');}if(!r.ok)throw new Error(data.error||'Request failed');return data}
function logout(){localStorage.removeItem('repToken');localStorage.removeItem('repInfo');state.token='';state.rep=null;render()}
function shell(content){return `<div class="shell"><header class="topbar"><div class="topbar-inner"><div class="brand"><span class="brandmark">P</span><span>Pasalho Sales</span></div><div class="grow"></div><span class="subtitle">${esc(state.rep?.name||'')}</span><button class="btn ghost small" onclick="logout()">Logout</button></div></header>${content}</div>`}
function login(){app.innerHTML=`<div class="login"><div class="card login-card stack"><div class="brand"><span class="brandmark">P</span><span>Pasalho Sales</span></div><div><div class="title">Sales rep sign in</div><div class="subtitle">Use the phone number and PIN created by the administrator.</div></div><div id="err"></div><div class="field"><label>Phone number</label><input id="phone" inputmode="tel" autocomplete="username"></div><div class="field"><label>PIN</label><input id="pin" type="password" inputmode="numeric" autocomplete="current-password"></div><button class="btn primary" id="loginBtn">Sign in</button></div></div>`;document.getElementById('loginBtn').onclick=async()=>{const b=document.getElementById('loginBtn');b.disabled=true;try{const d=await api('/api/auth/rep',{method:'POST',body:JSON.stringify({phone:document.getElementById('phone').value.trim(),pin:document.getElementById('pin').value})});state.token=d.token;state.rep=d.rep;localStorage.setItem('repToken',d.token);localStorage.setItem('repInfo',JSON.stringify(d.rep));await loadAll();state.screen='home';render()}catch(e){document.getElementById('err').innerHTML=`<div class="notice error">${esc(e.message)}</div>`}finally{b.disabled=false}}}
async function loadAll(){const [retailers,products,orders,config]=await Promise.all([api('/api/retailers'),api('/api/products'),api('/api/my/orders'),api('/api/config')]);Object.assign(state,{retailers,products,orders,config});}
function nav(){return `<div class="bottom"><div class="bottom-inner"><button class="btn ${state.screen==='home'?'primary':'secondary'}" onclick="go('home')">Order</button><button class="btn ${state.screen==='retailers'?'primary':'secondary'}" onclick="go('retailers')">Retailers</button><button class="btn ${state.screen==='orders'?'primary':'secondary'}" onclick="go('orders')">Orders</button><button class="btn ${state.screen==='payments'?'primary':'secondary'}" onclick="go('payments')">Payments</button></div></div>`}
function go(screen){state.screen=screen;if(screen!=='catalog'&&screen!=='review')state.search='';if(screen==='payments')loadUnpaid().then(render);else render()}
function home(){return shell(`<main class="mobile-container stack"><div class="hero"><div class="subtitle">Signed in as ${esc(state.rep.name)}</div><div class="title" style="margin-top:4px">Take an order</div><div style="margin-top:6px">Select an existing retailer or add a new one.</div></div><div class="search"><input class="input" id="rsearch" placeholder="Search retailer, area or phone"></div><div class="card" id="retList"></div><button class="btn secondary" onclick="openRetailerModal()">+ Add new retailer</button></main>${nav()}`)}
function renderRetailers(q=''){const list=state.retailers.filter(r=>(r.shop_name+' '+(r.area||'')+' '+(r.phone||'')).toLowerCase().includes(q.toLowerCase()));document.getElementById('retList').innerHTML=list.length?list.map(r=>`<div class="retailer row"><div class="grow"><div class="name">${esc(r.shop_name)}</div><div class="subtitle">${esc(r.area||'No area')} ${r.phone?'¬∑ '+esc(r.phone):''}</div><div class="subtitle">${r.order_count||0} orders ${r.last_order_at?'¬∑ last '+new Date(r.last_order_at).toLocaleDateString():''}</div></div><button class="btn primary small" onclick="startOrder(${r.id})">Order</button></div>`).join(''):`<div class="empty">No retailers found.</div>`}
function openRetailerModal(){document.body.insertAdjacentHTML('beforeend',`<div class="modal" id="retModal"><div class="modal-card stack"><div class="row between"><div class="title">New retailer</div><button class="btn ghost" onclick="closeModal('retModal')">‚úï</button></div><div id="retErr"></div><div class="grid2"><div class="field"><label>Shop name *</label><input id="shopName"></div><div class="field"><label>Owner / contact</label><input id="ownerName"></div><div class="field"><label>Phone</label><input id="retPhone" inputmode="tel"></div><div class="field"><label>Area / route</label><input id="area"></div></div><div class="field"><label>Delivery address</label><textarea id="address"></textarea></div><div class="field"><label>Location link / coordinates</label><input id="locationUrl" placeholder="Google Maps link"><button class="btn secondary small" style="margin-top:6px" onclick="captureLocation()">Use current location</button></div><div class="field"><label>Payment terms (days)</label><input id="terms" type="number" min="0" value="7"></div><buttn class="btn primary" onclick="saveRetailer()">Save retailer</button></div></div>`)}
function closeModal(id){document.getElementById(id)?.remove()}
function captureLocation(){if(!navigator.geolocation)return alert('Location is not supported on this device.');navigator.geolocation.getCurrentPosition(p=>{document.getElementById('locationUrl').value=`https://maps.google.com/?q=${p.coords.latitude},${p.coords.longitude}`},()=>alert('Could not access location.'))}
async function saveRetailer(){try{const r=await api('/api/retailers',{method:'POST',body:JSON.stringify({shopName:shopName.value,ownerName:ownerName.value,phone:retPhone.value,area:area.value,address:address.value,locationUrl:locationUrl.value,paymentTermsDays:Number(terms.value||7)});state.retailers.push({...r,order_count:0,lifetime_sales:0});closeModal('retModal');startOrder(r.id)}catch(e){document.getElementById('retErr').innerHTML=`<div class="notice error">${esc(e.message)}</div>`}}
function startOrder(id){state.selectedRetailer=state.retailers.find(r=>Number(r.id)===Number(id));state.cart={};state.search='';state.category='All';state.screen='catalog';render()}
function quote(p,qty){let price=Number(p.base_price),applied=null;for(const s of [...(p.slabs||[])].sort((a,b)=>Number(a.min_qty)-Number(b.min_qty)))if(qty>=Number(s.min_qty)){price=Number(s.price);applied=s}return{price,applied}}
function cartLines(){return Object.entries(state.cart).filter(([,q])=>Number(q)>0).map(([id,q])=>{const p=state.products.find(x=>Number(x.id)===Number(id)),qt=Number(q),x=quote(p,qt);return{p,qty:qt,price:x.price,total:x.price*qt,slab:x.applied}})}
function cartTotal(){return cartLines().reduce((a,l)=>a+l.total,0)}
function setQty(id,val){const q=Math.max(0,Number(val)||0);if(q)state.cart[id]=q;else delete state.cart[id];render()}
function catalog(){const cats=['All',...new Set(state.products.map(p=>p.category))];const list=state.products.filter(p=>(state.category==='All'||p.category===state.category)&&(p.name+' '+(p.sku||'')).toLowerCase().includes(state.search.toLowerCase()));return shell(`<main class="mobile-container stack"><div><div class="subtitle">Ordering for</div><div class="title">${esc(state.selectedRetailer.shop_name)}</div><div class="subtitle">${esc(state.selectedRetailer.area||'')} ${state.selectedRetailer.address?'¬∑ '+esc(state.selectedRetailer.address):''}</div></div><div class="search"><input class="input" placeholder="Search product or SKU" value="${esc(state.search)}" oninput="state.search=this.value;render()"></div><div class="chips">${cats.map(c=>`<button class="chip ${state.category===c?'active':''}" onclick="state.category=${JSON.stringify(c)};render()">${esc(c)}</button>`).join('')}</div><div class="card">${list.length?list.map(p=>{const q=Number(state.cart[p.id]||0),x=quote(p,Math.max(1,q)),next=(p.slabs||[]).find(s=>Number(s.min_qty)>q);return `<div class="product"><div class="row"><div class="grow"><div class="product-name">${esc(p.name)}</div><div class="product-meta">${esc(p.sku||'')} ¬∑ ${esc(p.unit)}</div><div class="price">${rs(x.price)} / ${esc(p.unit)}</div>${x.applied&&q?`<div class="slab">${x.applied.min_qty}+ price applied</div>`:next?`<div class="product-meta">Buy ${next.min_qty}+ ‚Üí ${rs(next.price)}</div>`:''}</div><div class="stepper"><button onclick="setQty(${p.id},${q}-1)">‚àí</button><input inputmode="decimal" value="${q||''}" placeholder="0" onchange="setQty(${p.id},this.value)"><button onclick="setQty(${p.id},${q}+1)">+</button></div></div></div>`}).join(''):`<div class="empty">No products found.</div>`}</div></main><div class="bottom"><div class="bottom-inner"><div class="cartinfo"><b>${rs(cartTotal())}</b><span>${cartLines().length} items</span></div><button class="btn primary" ${cartLines().length?'':'disabled'} onclick="state.screen='review';render()">Review order</button></div></div>`)}
function review(){const lines=cartLines();return shell(`<main class="mobile-container stack"><button class="btn ghost" style="align-self:flex-start" onclick="state.screen='catalog';render()">‚Üê Back</button><div><div class="title">Review order</div><div class="subtitle">${esc(state.selectedRetailer.shop_name)}</div></div><div class="card">${lines.map(l=>`<div class="product"><div class="row between"><div><div class="product-name">${esc(l.p.name)}</div><div class="product-meta">${l.qty} ${esc(l.p.unit)} √ó ${rs(l.price)}</div></div><strong>${rs(l.total)}</strong></div></div>`).join('')}</div><div class="field"><label>Delivery date</label><input id="deliveryDate" type="date" min="${new Date().toISOString().slice(0,10)}"></div><div class="field"><label>Delivery / order note</label><textarea id="orderNote" placeholder="Landmark, timing, special instructions"></textarea></div><div class="card pad row between"><strong>Total</strong><div class="title">${rs(cartTotal())}</div></div><div id="submitErr"></div><button class="btn primary" onclick="submitOrder(this)">Confirm order</button></main>`)}
async function submitOrder(btn){btn.disabled=true;try{const d=await api('/api/orders',{method:'POST',body:JSON.stringify({retailerId:state.selectedRetailer.id,items:cartLines().map(l=>({productId:l.p.id,quantity:l.qty})),deliveryDate:document.getElementById('deliveryDate').value||null,notes:document.getElementById('orderNote').value})});state.lastOrder=d;state.orders.unshift({...d,order_no:d.orderNo,shop_name:d.retailer.shop_name,created_at:new Date().toISOString()});state.cart={};state.screen='success';render()}catch(e){document.getElementById('submitErr').innerHTML=`<div class="notice error">${esc(e.message)}</div>`;btn.disabled=false}}
function waUrl(o){const lines=o.items.map((x,i)=>`${i+1}. ${x.name}\n${x.quantity} ${x.unit} √ó ${rs(x.unitPrice)} = ${rs(x.lineTotal)}`).join('\n\n');const r=o.retailer;const location=r.location_url?`\nLocation: ${r.location_url}`:'';const msg=`PASALHO ORDER\n\nOrder: ${o.orderNo}\nRetailer: ${r.shop_name}\nContact: ${r.owner_name||'-'}\nPhone: ${r.phone||'-'}\nArea: ${r.area||'-'}\nAddress: ${r.address||'-'}${location}\nSales Rep: ${o.salesRep}\n\n${lines}\n\nTOTAL: ${rs(o.total)}\nDelivery: ${o.deliveryDate||'Not specified'}\n${o.notes?`Note: ${o.notes}\n`:''}`;return `https://wa.me/${state.config.whatsappNumber}?text=${encodeURIComponent(msg)}`}
function success(){const o=state.lastOrder;return shell(`<main class="mobile-container stack"><div class="hero"><div class="subtitle">Order created</div><div class="title">${esc(o.orderNo)}</div><div style="font-size:28px;font-weight:850;margin-top:10px">${rs(o.total)}</div></div><div class="card pad"><strong>${esc(o.retailer.shop_name)}</strong><div class="subtitle">The order is saved in the pilot database.</div></div>${state.config.whatsappNumber?`<a class="btn primary" target="_blank" rel="noopener" href="${waUrl(o)}">Send to WhatsApp</a>`:`<div class="notice warn">WHATSAPP_NUMBER has not been configured on the server.</div>`}<buttn class="btn secondary" onclick="state.screen='home';render()">Take another order</button></main>${nav()}`)}
function retailers(){return shell(`<main class="mobile-container stack"><div class="row between"><div><div class="title">Retailers</div><div class="subtitle">Your assigned retailer list</div></div><button class="btn primary small" onclick="openRetailerModal()">+ Add</button></div><div class="card">${state.retailers.length?state.retailers.map(r=>`<div class="retailer"><div class="row between"><div><div class="name">${esc(r.shop_name)}</div><div class="subtitle">${esc(r.owner_name||'')} ${r.phone?'¬∑ '+esc(r.phone):''}</div><div class="subtitle">${esc(r.area||'')} ${r.address?'¬∑ '+esc(r.address):''}</div></div><button class="btn secondary small"€ò€X⁄œHú›\ù‹ô\ä	‹ãöYJHèì‹ô\èÿù]€èèŸ]èâ‹ãõÿÿ][€ó›\õÿH€\‹œHòùà⁄‹›€X[à\ôŸ]Hóÿõ[ö»àôYèHâŸ\ÿ ãõÿÿ][€ó›\õ
_Hèì‹[àÿÿ][€èÿOòâ…ﬂOŸ]èò
Köõ⁄[ä	… Nò]à€\‹œHô[\Hèìõ»ô]Z[\ú»Y]èŸ]èòOŸ]èè€XZ[èâ€ò]ä
_X
_Bôù[ò›[€à‹ô\ú 
^‹ô]\õà⁄[
XZ[à€\‹œHõ[ÿö[KX€€ùZ[ô\à›X⁄»èè]èè]à€\‹œHù]Hèì^H‹ô\úœŸ]èè]à€\‹œHú›Xù]Hèì]\›L‹ô\úœŸ]èèŸ]èè]à€\‹œHòÿ\ôèâ‹›]Kõ‹ô\úÀõ[ô›‹›]Kõ‹ô\úÀõX\
œOò]à€\‹œHúô]Z[\àõ›»èè]à€\‹œHô‹õ›»èè]à€\‹œHõò[YHèâŸ\ÿ Àú⁄‹€ò[Y_Àúô]Z[\èÀú⁄‹€ò[Y_	‘ô]Z[\â _OŸ]èè]à€\‹œHú›Xù]HèâŸ\ÿ Àõ‹ô\ó€õﬂÀõ‹ô\ìõ _H0≠»	€ô]»]JÀò‹ôX]Yÿ]]Kõõ› 
JKù”ÿÿ[T›ö[ô 
_OŸ]èèŸ]èè]à›[OHù^X[Y€éúöY⁄èè›õ€ôœâ‹ú Àù›[
_O‹›õ€ôœè]à€\‹œHú›Xù]HèâŸ\ÿ Àú›]\ﬂ	”ëU… _OŸ]èèŸ]èèŸ]èò
Köõ⁄[ä	… Nò]à€\‹œHô[\Hèìõ»‹ô\ú»Y]èŸ]èòOŸ]èè€XZ[èâ€ò]ä
_X
_Bò\ﬁ[ò»ù[ò›[€àÿY[úZY

^›û^‹›]Kù[úZYX]ÿZ]\J	Àÿ\K€^K›[úZY[‹ô\ú… _Xÿ]⁄‹›]Kù[úZYV◊__Bôù[ò›[€à^[Y[ù 
^‹ô]\õà⁄[
XZ[à€\‹œHõ[ÿö[KX€€ùZ[ô\à›X⁄»èè]èè]à€\‹œHù]HèîôX€‹ô^[Y[ùŸ]èè]à€\‹œHú›Xù]HèîôX€‹ô€€X›[€ú»YÿZ[ú›[à‹ô\à€»^[Y[ù[Z[ô»›^\»Xÿ›\ò]KèŸ]èèŸ]èè]à€\‹œHòÿ\ôèâ‹›]Kù[úZYõ[ô›‹›]Kù[úZYõX\
œOò]à€\‹œHúô]Z[\àõ›»èè]à€\‹œHô‹õ›»èè]à€\‹œHõò[YHèâŸ\ÿ Àú⁄‹€ò[YJ_OŸ]èè]à€\‹œHú›Xù]HèâŸ\ÿ Àõ‹ô\ó€õ _H0≠»ò[[òŸH	‹ú Àòò[[òŸJ_OŸ]èèŸ]èèù]€à€\‹œHòùàö[X\ûH€X[à€ò€X⁄œHú^[Y[ù[Ÿ[
	€ÀöYJHèê€€X›ÿù]€èèŸ]èò
Köõ⁄[ä	… Nò]à€\‹œHô[\Hèìõ»[úZY‹ô\ú»\‹⁄Y€ôY»[›KèŸ]èòOŸ]èè€XZ[èâ€ò]ä
_X
_Bôù[ò›[€à^[Y[ù[Ÿ[
‹ô\íY
^ÿ€€ú›œ\›]Kù[úZYôö[ô
Oìù[Xô\äöY
OOOSù[Xô\ä‹ô\íY
JNŸÿ›[Y[ùòõŸKö[úŸ\ùYòXŸ[ùS
	ÿôYõ‹ôY[ô	À]à€\‹œHõ[Ÿ[àYHú^S[Ÿ[èè]à€\‹œHõ[Ÿ[Xÿ\ô›X⁄»èè]à€\‹œHúõ›»ô]ŸY[àèè]èè]à€\‹œHù]HèîôX€‹ô^[Y[ùŸ]èè]à€\‹œHú›Xù]HèâŸ\ÿ Àú⁄‹€ò[YJ_H0≠»	Ÿ\ÿ Àõ‹ô\ó€õ _OŸ]èèŸ]èèù]€à€\‹œHòùà⁄‹›à€ò€X⁄œHò€‹ŸS[Ÿ[
	‹^S[Ÿ[	 Hè∏ß%Oÿù]€èèŸ]èè]à€\‹œHõõ›XŸHèì›]›[ô[ô»€à\»‹ô\éà›õ€ôœâ‹ú Àòò[[òŸJ_O‹›õ€ôœèŸ]èè]àYHú^Q\úàèèŸ]èè]à€\‹œHôöY[èèXô[ê[[›[ù
è€Xô[è[ú]YHú^P[[›[ùà\OHõù[Xô\ààZ[èHååHàX^Hâ”ù[Xô\äÀòò[[òŸJ_Hà›\HååHèèŸ]èè]à€\‹œHôöY[èèXô[î^[Y[ù]O€Xô[è[ú]YHú^Q]Hà\OHô]Hàò[YOHâ€ô]»]J
Kù“T”‘›ö[ô 
Kú€XŸJL
_HèèŸ]èè]à€\‹œHôöY[èèXô[ìY]Ÿ€Xô[èŸ[X›YHú^SY]Ÿèè‹[€èêÿ\⁄€‹[€èè‹[€èêò[öœ€‹[€èè‹[€èôTŸ]ÿO€‹[€èè‹[€èí⁄[O€‹[€èè‹[€èì›\è€‹[€èè‹Ÿ[X›èŸ]èè]à€\‹œHôöY[èèXô[ìõ›O€Xô[è^\ôXHYHú^Sõ›Hèè›^\ôXOèŸ]èèù]€à€\‹œHòùàö[X\ûHà€ò€X⁄œHúÿ]ôT^[Y[ù
	€ÀöYK	€Àúô]Z[\ó⁄YJHèîÿ]ôH^[Y[ùÿù]€èèŸ]èèŸ]èò
_Bò\ﬁ[ò»ù[ò›[€àÿ]ôT^[Y[ù
‹ô\íYô]Z[\íY
^›û^ÿ]ÿZ]\J	Àÿ\K‹^[Y[ù…À€Y]Ÿâ‘‘’	ÀõŸNíî””ãú›ö[ô⁄YûJ€‹ô\íYô]Z[\íY[[›[ùìù[Xô\ä^P[[›[ùùò[YJK^[Y[ù]Nú^Q]Kùò[YKY]Ÿú^SY]Ÿùò[YKõ›Nú^Sõ›Kùò[Y_J_JNÿ€‹ŸS[Ÿ[
	‹^S[Ÿ[	 Nÿ]ÿZ]õ€Z\ŸKò[
€ÿY[úZY

K\J	Àÿ\K€^K€‹ô\ú… Kù[äOú›]Kõ‹ô\úœ^
WJN‹ô[ô\ä
_Xÿ]⁄
J^Ÿÿ›[Y[ùôŸ][[Y[ùûRY
	‹^Q\úâ Kö[õô\íSX]à€\‹œHõõ›XŸH\úõ‹àèâŸ\ÿ KõY\‹ÿYŸJ_OŸ]èò_Bôù[ò›[€àô[ô\ä
^⁄Yä\›]Kù⁄Ÿ[ä\ô]\õàŸ⁄[ä
N⁄Yä›]Kúÿ‹ôY[èOOI⁄€YI ^ÿ\ö[õô\íSZ€YJ
N‹Ÿ][Y[›]


OOûÿ€€ú›[Yÿ›[Y[ùôŸ][[Y[ùûRY
	‹úŸX\ò⁄	 N⁄Yä[
^‹ô[ô\îô]Z[\ú 
NŸ[õ€ö[ú]J
OOúô[ô\îô]Z[\ú [ùò[YJ__K
N‹ô]\õüZYä›]Kúÿ‹ôY[èOOIÿÿ][Ÿ… ^ÿ\ö[õô\íSXÿ][Ÿ 
N‹ô]\õüZYä›]Kúÿ‹ôY[èOOI‹ô]öY]… ^ÿ\ö[õô\íS\ô]öY] 
N‹ô]\õüZYä›]Kúÿ‹ôY[èOOI‹›XÿŸ\‹… ^ÿ\ö[õô\íS\›XÿŸ\‹ 
N‹ô]\õüZYä›]Kúÿ‹ôY[èOOI‹ô]Z[\ú… ^ÿ\ö[õô\íS\ô]Z[\ú 
N‹ô]\õüZYä›]Kúÿ‹ôY[èOOI€‹ô\ú… ^ÿ\ö[õô\íS[‹ô\ú 
N‹ô]\õüZYä›]Kúÿ‹ôY[èOOI‹^[Y[ù… ^ÿ\ö[õô\íS\^[Y[ù 
N‹ô]\õü_Bù⁄[ô›Àú›]O\›]N›⁄[ô›ÀõŸ€›][Ÿ€›]›⁄[ô›Àô€œY€Œ›⁄[ô›Àõ‹[îô]Z[\ì[Ÿ[[‹[îô]Z[\ì[Ÿ[›⁄[ô›Àò€‹ŸS[Ÿ[X€‹ŸS[Ÿ[›⁄[ô›Àòÿ\\ôSÿÿ][€èXÿ\\ôSÿÿ][€é›⁄[ô›Àúÿ]ôTô]Z[\è\ÿ]ôTô]Z[\é›⁄[ô›Àú›\ù‹ô\è\›\ù‹ô\é›⁄[ô›ÀúŸ]]O\Ÿ]]N›⁄[ô›Àú›XõZ]‹ô\è\›XõZ]‹ô\é›⁄[ô›Àú^[Y[ù[Ÿ[\^[Y[ù[Ÿ[›⁄[ô›Àúÿ]ôT^[Y[ù\ÿ]ôT^[Y[ù¬ä\ﬁ[ò 
OOû⁄Yä	‹Ÿ\ùöXŸU€‹öŸ\â⁄[àò]öYÿ]‹ä[ò]öYÿ]‹ãúŸ\ùöXŸU€‹öŸ\ãúôY⁄\›\ä	À‹›Àöú… Kòÿ]⁄


OOûﬂJN⁄Yä›]Kù⁄Ÿ[ä^›û^ÿ]ÿZ]ÿY[

_Xÿ]⁄
J^ÿ€€ú€€Kô\úõ‹äJ__\ô[ô\ä
_JJ
N¬