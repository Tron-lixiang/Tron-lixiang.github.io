(()=>{const t=localStorage;window;const a=document,H=FileReader,M=fetch,r=a.documentElement,n=a.body,D=a.head,l=e=>a.createElement(e),i=e=>new Image,c=(e,t,o)=>e["on"+t]=o,s=e=>e.getBoundingClientRect(),g=setTimeout,d=Math,m=URL,v="click",f="load",o="level",h="style",p="src",F="href",O="then",u="setAttribute",P="getAttribute",W="removeAttribute",z="referrer",w="data-";const G=w+"running",J=w+f+"ing",b="children",K="stopPropagation",N="createObjectURL",x="display",y="innerHTML",$="width",R="height",Q="left",A=0,L=2,V=1e3;const B="",X="a",I="target",Y=/weibo|qq/i.test(navigator.userAgent),q=(e,t=a)=>t.querySelector(e);const Z="china-ex-levels",C=1134,E=L,_=q("#地区");var ee=q("#保存"),e=q("#输出");const te=q("img",e),S=q("#设置等级"),T=l("canvas"),U=T.getContext("2d"),oe=(T[$]=C*E,T[R]=C*E,n[b][A]),ne=S[b][A],j=S[h],ae=e[h],re=e=>{j[x]=B},le={},ie=e=>[..._[b]],ce=e=>ie().map(e=>e[P](o)||A),se=e=>ce().join(B);c(_,v,e=>{e[K]();var e=e[I],t=s(e),e=(le.省元素=e,ne[y]=e.id,j[x]="block",s(S)),o=d.round(r.scrollLeft+t[Q]+t[$]/L-e[$]/L),o=d.min(o,n.offsetWidth-e[$]-6),t=(o=d.max(o,6),d.round(r.scrollTop+t.top+t[R]/L-e[R]/L)),t=d.min(t,n.offsetHeight-e[R]-6);t=d.max(t,6),j[Q]=o+"px",j.top=t+"px"}),c(a,v,re);const ge=e=>{var t=ce().reduce((e,t)=>e+(+t||A),A);分数[y]="分数: "+t};c(S,v,e=>{e[K]();e=e[I][P](w+o);e&&(le.省元素[u](o,e),ge(),re(),t.setItem(Z,se()))});{const fe=t.getItem(Z)||B;ie().forEach((e,t)=>{e[u](o,fe[t]||A)})}ge();const de=(e,t)=>{var o=new H;c(o,f,e=>t(e[I].result)),o.readAsDataURL(e)};var k,me,ve;k="字体",me=e=>{q(h,oe)[y]=e;var t=l(h);t[y]=e,D.appendChild(t),g(e=>r[W](J),L*V)},ve=e=>me(`@font-face{font-family:${k};${p}:url(${e})}`),M("travel-path.woff")[O](e=>e.blob())[O](e=>de(e,ve));c(ee,v,e=>{r[u](G,!0);var t=(e=>{e=new Blob([e],{type:"image/svg+xml"});return m[N](e)})(`<?xml version="1.0" encoding="utf-8"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1134 976" ${$}="1134px" ${R}="976px">${oe[y]}</svg>`);{var o=e=>{U.fillStyle="#efb4b4",U.fillRect(A,A,C*E,C*E),U.drawImage(e,A,A,C,976,A,158*E/L,C*E,976*E),T.toBlob(e=>{const a=m[N](e);te[p]=a,ae[x]=B,g(e=>{var t,o,n;t=a,o="[lixiangpro.com][中国制霸].png",n=l(X),Y||(n.download=o),n[F]=t,n[v](),r[W](G)},50)})};const n=i();c(n,f,e=>g(e=>o(n),V/L)),n[p]=t}i()[p]=`https://lab.magiconch.com/api/china-ex/log?levels=${se()}&r=`+a[z]}),c(q(X,e),v,e=>{ae[x]="none"})})();