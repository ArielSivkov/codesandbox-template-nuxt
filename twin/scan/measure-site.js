
// ===== מודול מדידה: מישור משבצות (הומוגרפיה) + גובה מצלמה/אופק, עם סטיית תקן מחושבת וכיול עצמי =====
(function(){
'use strict';
var $=function(id){return document.getElementById(id);};
var LOGF='13A1TiHDNsDw5nZTgVupR9qvYBxJXZaTG';
var M={img:null,iw:0,ih:0,f35:26,fSrc:'ברירת מחדל',pts:[],mode:'plane',file:null,res:null};
var cal=loadCal();

// ---------- מתמטיקה ----------
function gauss(){var u=0,v=0;while(!u)u=Math.random();while(!v)v=Math.random();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);}
function solve(A,b){var n=b.length,i,j,k;for(i=0;i<n;i++){var p=i;for(j=i+1;j<n;j++)if(Math.abs(A[j][i])>Math.abs(A[p][i]))p=j;
  var t=A[i];A[i]=A[p];A[p]=t;t=b[i];b[i]=b[p];b[p]=t;if(Math.abs(A[i][i])<1e-12)return null;
  for(j=i+1;j<n;j++){var f=A[j][i]/A[i][i];for(k=i;k<n;k++)A[j][k]-=f*A[i][k];b[j]-=f*b[i];}}
  var x=new Array(n);for(i=n-1;i>=0;i--){var s=b[i];for(k=i+1;k<n;k++)s-=A[i][k]*x[k];x[i]=s/A[i][i];}return x;}
function homog(src,dst){var A=[],b=[];for(var i=0;i<4;i++){var x=src[i][0],y=src[i][1],X=dst[i][0],Y=dst[i][1];
  A.push([x,y,1,0,0,0,-x*X,-y*X]);b.push(X);A.push([0,0,0,x,y,1,-x*Y,-y*Y]);b.push(Y);}
  var h=solve(A,b);return h?h.concat(1):null;}
function apply(H,p){var w=H[6]*p[0]+H[7]*p[1]+1;return[(H[0]*p[0]+H[1]*p[1]+H[2])/w,(H[3]*p[0]+H[4]*p[1]+H[5])/w];}
function stats(a){var n=a.length,m=0,s=0,i;for(i=0;i<n;i++)m+=a[i];m/=n;for(i=0;i<n;i++)s+=(a[i]-m)*(a[i]-m);return{m:m,s:Math.sqrt(s/(n-1))};}
function fpx(){return M.f35*Math.hypot(M.iw,M.ih)/43.27;}   // מוקד בפיקסלים מאורך מוקד שקול 35 מ"מ (אלכסון 43.27 מ"מ)

// מונטה-קרלו: מרעיד כל נקודה בסטיית ההקשה, ואת הערכים הידועים בסטיית התקן שלהם
function mc(fn,N){var out=[],i;for(i=0;i<(N||400);i++){var r=fn(function(p){var s=sigPx();return[p[0]+gauss()*s,p[1]+gauss()*s];});if(r!=null&&isFinite(r))out.push(r);}
  return out.length>20?stats(out):null;}
function sigPx(){return (+$('mSigTap').value||2)*M.iw/Math.max(1,$('mCv').clientWidth);}   // שגיאת הקשה במסך → פיקסלים בתמונה
function num(id){return +$(id).value;}

function computePlane(){
  var P=M.pts;if(P.length<4)return null;var W=num('mW')/100,H=num('mH')/100,sW=num('mWs')/100,sH=num('mHs')/100;
  var ref=P.slice(0,4),meas=P.slice(4),rows=[],i,j;
  function Hm(jit,w,h){var s=ref.map(jit);return homog(s,[[0,0],[w,0],[w,h],[0,h]]);}
  for(i=0;i<meas.length;i++)for(j=i+1;j<meas.length;j++)(function(a,b){
    var st=mc(function(jit){var w=W+gauss()*sW,h=H+gauss()*sH,Hh=Hm(jit,w,h);if(!Hh)return null;var A=apply(Hh,jit(a)),B=apply(Hh,jit(b));return Math.hypot(A[0]-B[0],A[1]-B[1]);});
    rows.push({a:i+1,b:j+1,st:st});})(meas[i],meas[j]);
  // בדיקת עקביות: המלבן הייחוס עצמו
  return{type:'plane',rows:rows,n:meas.length};
}
function computeHeight(){
  var P=M.pts;if(P.length<3)return null;var hz=P[0],h=num('mCam'),sh=num('mCams'),f0=fpx(),sf=f0*(num('mFs')/100),cy=M.ih/2,rows=[],k;
  for(k=1;k+1<P.length;k+=2)(function(base,top,idx){
    function geo(jit){var f=f0+gauss()*sf,hc=h+gauss()*sh,z=jit(hz),b=jit(base),t=jit(top);
      var pitch=Math.atan((cy-z[1])/f);   // זווית המצלמה מתחת/מעל לאופק
      var aB=Math.atan((b[1]-cy)/f)+pitch;if(aB<=0.001)return null;var d=hc/Math.tan(aB);
      var aT=Math.atan((cy-t[1])/f)-pitch;return{d:d,H:hc+d*Math.tan(aT)};}
    var sd=mc(function(j){var g=geo(j);return g&&g.d;}),sH=mc(function(j){var g=geo(j);return g&&g.H;});
    rows.push({i:idx,d:sd,H:sH});})(P[k],P[k+1],(k+1)/2);
  return{type:'height',rows:rows};
}
// ---------- כיול עצמי ----------
function loadCal(){try{return JSON.parse(localStorage.getItem('esh27cal')||'{"plane":[],"height":[]}');}catch(e){return{plane:[],height:[]};}}
function saveCal(){try{localStorage.setItem('esh27cal',JSON.stringify(cal));}catch(e){}}
function calStat(t){var a=cal[t]||[];if(a.length<2)return{b:0,s:0,n:a.length};var st=stats(a.map(function(x){return x.err;}));return{b:st.m,s:st.s,n:a.length};}
function corr(t,st){if(!st)return null;var c=calStat(t),m=st.m/(1+c.b),s=Math.sqrt(st.s*st.s+Math.pow(c.s*m,2));return{m:m,s:s};}
function fmt(st,u){if(!st)return'—';var cm=u==='cm';var m=cm?st.m*100:st.m,s=cm?st.s*100:st.s;var d=s<0.1?3:s<1?2:s<10?1:0;return m.toFixed(d)+' ± '+s.toFixed(d)+(cm?' ס"מ':' מ\'');}

// ---------- ציור ----------
function draw(){var cv=$('mCv');if(!M.img)return;var W=cv.clientWidth,sc=W/M.iw;cv.width=W*devicePixelRatio;cv.height=M.ih*sc*devicePixelRatio;cv.style.height=(M.ih*sc)+'px';
  var g=cv.getContext('2d');g.setTransform(devicePixelRatio*sc,0,0,devicePixelRatio*sc,0,0);g.drawImage(M.img,0,0);
  var r=6/sc;g.lineWidth=2/sc;
  if(M.mode==='plane'&&M.pts.length>=2){g.strokeStyle='#ff8a3d';g.beginPath();M.pts.slice(0,4).forEach(function(p,i){i?g.lineTo(p[0],p[1]):g.moveTo(p[0],p[1]);});if(M.pts.length>=4)g.closePath();g.stroke();}
  if(M.mode==='height'&&M.pts[0]){g.strokeStyle='#3ecf8e';g.setLineDash([10/sc,8/sc]);g.beginPath();g.moveTo(0,M.pts[0][1]);g.lineTo(M.iw,M.pts[0][1]);g.stroke();g.setLineDash([]);
    for(var k=1;k+1<M.pts.length;k+=2){g.strokeStyle='#5ab0ff';g.beginPath();g.moveTo(M.pts[k][0],M.pts[k][1]);g.lineTo(M.pts[k+1][0],M.pts[k+1][1]);g.stroke();}}
  M.pts.forEach(function(p,i){var ref=M.mode==='plane'?i<4:i===0;g.fillStyle=ref?'#ff8a3d':'#5ab0ff';g.beginPath();g.arc(p[0],p[1],r,0,7);g.fill();
    g.fillStyle='#fff';g.font=(14/sc)+'px sans-serif';g.fillText(label(i),p[0]+r*1.4,p[1]-r*1.4);});
  hint();}
function label(i){if(M.mode==='plane')return i<4?('ר'+(i+1)):String(i-3);if(i===0)return'אופק';var o=Math.ceil(i/2);return(i%2?'בסיס ':'ראש ')+o;}
function hint(){var n=M.pts.length,t;
  if(M.mode==='plane')t=n<4?('הקש פינה '+(n+1)+' מתוך 4 של מלבן ידוע (משבצת/מרצפת), לפי הסדר מסביב.'):'עכשיו הקש נקודות למדידה. כל זוג נמדד – מקבלים מטריצת מרחקים.';
  else t=n<1?'הקש על קו האופק (או נקודה בגובה העיניים שלך רחוק).':((n%2)?'הקש על בסיס העצם (איפה שהוא נוגע בקרקע).':'הקש על ראש העצם.');
  $('mHint').textContent=t;}
function loupe(p){var L=$('mLoupe'),g=L.getContext('2d'),z=4,R=L.width/2;g.clearRect(0,0,L.width,L.height);g.save();g.beginPath();g.arc(R,R,R,0,7);g.clip();
  var sw=140/z*(M.iw/$('mCv').clientWidth);
  g.drawImage(M.img,p[0]-sw/2,p[1]-sw/2,sw,sw,0,0,L.width,L.height);g.restore();g.strokeStyle='#ff8a3d';g.beginPath();g.moveTo(R-10,R);g.lineTo(R+10,R);g.moveTo(R,R-10);g.lineTo(R,R+10);g.stroke();L.style.display='block';}

// ---------- קלט ----------
function evPt(e){var cv=$('mCv'),r=cv.getBoundingClientRect(),t=e.touches?e.touches[0]:e,sc=M.iw/r.width;return[(t.clientX-r.left)*sc,(t.clientY-r.top)*sc];}
var drag=-1;
function near(p){var best=-1,bd=18*M.iw/$('mCv').clientWidth;M.pts.forEach(function(q,i){var d=Math.hypot(q[0]-p[0],q[1]-p[1]);if(d<bd){bd=d;best=i;}});return best;}
function down(e){if(!M.img)return;e.preventDefault();var p=evPt(e);drag=near(p);if(drag<0){M.pts.push(p);drag=M.pts.length-1;}loupe(M.pts[drag]);draw();}
function move(e){if(drag<0)return;e.preventDefault();M.pts[drag]=evPt(e);loupe(M.pts[drag]);draw();}
function up(){if(drag<0)return;drag=-1;$('mLoupe').style.display='none';calc();}

function exifF(buf){try{var v=new DataView(buf),o=2;if(v.getUint16(0)!==0xFFD8)return null;
  while(o<v.byteLength){var mk=v.getUint16(o);if(mk===0xFFE1){var t=o+10,le=v.getUint16(t)===0x4949;var u16=function(p){return v.getUint16(p,le);},u32=function(p){return v.getUint32(p,le);};
    var find=function(p,tag){var n=u16(p);for(var i=0;i<n;i++){var e=p+2+i*12;if(u16(e)===tag)return e;}return-1;};
    var ifd0=t+u32(t+4),ex=find(ifd0,0x8769);if(ex<0)return null;var sub=t+u32(ex+8);
    var e35=find(sub,0xA405);if(e35>=0)return{f35:u16(e35+8),src:'EXIF (שקול 35 מ"מ)'};
    return null;}o+=2+v.getUint16(o+2);}}catch(e){}return null;}

function load(file){M.file=file;if(!(file instanceof File))M.f35=+$('mF').value||24;M.pts=[];M.res=null;var fr=new FileReader();fr.onload=function(){var f=exifF(fr.result);if(f&&f.f35){M.f35=f.f35;M.fSrc=f.src;}else{M.f35=+$('mF').value||26;M.fSrc='ברירת מחדל – תקן לפי הטלפון';}
    $('mF').value=M.f35;$('mFsrc').textContent=M.fSrc;};fr.readAsArrayBuffer(file);
  createImageBitmap(file,{imageOrientation:'from-image'}).catch(function(){return createImageBitmap(file);}).then(function(bm){M.img=bm;M.iw=bm.width;M.ih=bm.height;$('mOut').innerHTML='';draw();});}

function calc(){M.f35=+$('mF').value||M.f35;var r=M.mode==='plane'?computePlane():computeHeight();M.res=r;var o=$('mOut');if(!r){o.innerHTML='';return;}
  var c=calStat(M.mode),h='';
  if(r.type==='plane'){if(!r.rows.length){o.textContent='הוסף לפחות 2 נקודות מדידה.';return;}
    h='<table><tr><th>זוג</th><th>מרחק (מתוקן)</th><th>בדיקה</th></tr>'+r.rows.map(function(x,i){return'<tr><td>'+x.a+'↔'+x.b+'</td><td>'+fmt(corr('plane',x.st),x.st&&x.st.m<2?'cm':'m')+'</td><td><button class="sm" data-k="'+i+'">ערך ידוע</button></td></tr>';}).join('')+'</table>';}
  else{h='<table><tr><th>עצם</th><th>מרחק (עומק)</th><th>גובה</th><th>בדיקה</th></tr>'+r.rows.map(function(x,i){return'<tr><td>'+x.i+'</td><td>'+fmt(corr('height',x.d))+'</td><td>'+fmt(corr('height',x.H))+'</td><td><button class="sm" data-k="'+i+'">גובה ידוע</button></td></tr>';}).join('')+'</table>';}
  h+='<div class="msg">כיול עצמי: '+c.n+' בדיקות'+(c.n>=2?(' · הטיה '+(c.b*100).toFixed(1)+'% · פיזור '+(c.s*100).toFixed(1)+'%'):' · עוד אין מספיק בדיקות – סטיית התקן היא מההקשות והייחוס בלבד')+'</div>';
  o.innerHTML=h;
  Array.prototype.forEach.call(o.querySelectorAll('button[data-k]'),function(b){b.onclick=function(){var x=r.rows[+b.dataset.k],st=r.type==='plane'?x.st:x.H;if(!st)return;
    var v=prompt('מה הערך האמיתי? ('+(r.type==='plane'?'ס"מ':'מטרים')+')');if(!v)return;var tv=+v/(r.type==='plane'?100:1);if(!(tv>0))return;
    cal[M.mode].push({err:(st.m-tv)/tv,t:Date.now()});saveCal();calc();};});}

function save(){if(!M.res||!window.__esh27upload){$('mSave').textContent='אין חיבור';return;}var d=new Date(),ts=d.toISOString().replace(/[:.]/g,'-');
  var rec={when:d.toISOString(),mode:M.mode,image:{w:M.iw,h:M.ih,f35:M.f35,fSrc:M.fSrc},sensors:M.sens||null,points:M.pts,inputs:{W_cm:num('mW'),H_cm:num('mH'),sW_cm:num('mWs'),sH_cm:num('mHs'),cam_m:num('mCam'),scam_m:num('mCams'),f_sigma_pct:num('mFs'),tap_px:num('mSigTap')},
    result:M.res,calibration:calStat(M.mode),calibration_log:cal[M.mode],note:$('mNote').value,method:'מונטה-קרלו 400 דגימות; מישור: הומוגרפיה מ-4 פינות; גובה: גובה מצלמה + קו אופק + מוקד'};
  $('mSave').textContent='שומר…';
  window.__esh27upload('measure_'+ts+'.jpg',M.file,{kind:'measure',measurement:rec}).then(function(){$('mSave').textContent='✓ נשמר ונכנס לתור';},function(){$('mSave').textContent='השמירה נכשלה – ינסה שוב לבד';});}
function mode(m){M.mode=m;M.pts=[];$('mmP').className=m==='plane'?'on':'';$('mmH').className=m==='height'?'on':'';$('mPlaneIn').hidden=m!=='plane';$('mHgtIn').hidden=m!=='height';$('mOut').innerHTML='';draw();hint();}
$('mmP').onclick=function(){mode('plane');};$('mmH').onclick=function(){mode('height');};
$('mFile').onchange=function(){if(this.files&&this.files[0])load(this.files[0]);this.value='';};
$('mLast').onclick=function(){var L=window.__esh27sensors&&window.__esh27sensors().last;if(!L){$('mHint').textContent='עוד לא צילמת בטאב הסריקה';return;}M.sens=L.meta;load(L.blob);};
$('mAutoH').onclick=function(){var t=(M.sens&&M.sens.tilt)||(window.__esh27sensors&&window.__esh27sensors().tilt);if(!t||!M.img){$('mHint').textContent='אין נתוני הטיה לתמונה הזאת – סמן אופק ידנית';return;}if(M.mode!=='height')mode('height');var f=fpx(),y=M.ih/2-f*Math.tan(t.pitch*Math.PI/180);M.pts=[[M.iw/2,y]];M.horizonFromSensor=true;draw();calc();};
$('mUndo').onclick=function(){M.pts.pop();draw();calc();};$('mClear').onclick=function(){M.pts=[];draw();calc();};$('mSave').onclick=save;
['mW','mH','mWs','mHs','mCam','mCams','mF','mFs','mSigTap'].forEach(function(id){$(id).oninput=calc;});
var cv=$('mCv');cv.addEventListener('touchstart',down,{passive:false});cv.addEventListener('touchmove',move,{passive:false});cv.addEventListener('touchend',up);
cv.addEventListener('mousedown',down);window.addEventListener('mousemove',function(e){if(drag>=0)move(e);});window.addEventListener('mouseup',up);
window.addEventListener('resize',draw);hint();
// חשיפה לבדיקות
window.__esh27measure={redraw:draw,homog:homog,apply:apply,M:M,computePlane:computePlane,computeHeight:computeHeight};
})();
