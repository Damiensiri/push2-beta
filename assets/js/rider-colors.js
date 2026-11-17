(()=>{
  const palette=['#39c3ff','#ff64b1','#a46cff','#ffbd21','#50d89c','#ff7a45','#58a6ff','#d579ff'];
  const hash=value=>{let result=0;for(const char of String(value||''))result=(result*31+char.charCodeAt(0))>>>0;return result};
  function create(ids=[]){
    const keys=[...new Set(ids.map(value=>String(value||'')).filter(Boolean))].sort(),colors=new Map(),used=new Set();
    for(const key of keys){const start=hash(key)%palette.length;let color=palette[start];for(let offset=0;offset<palette.length;offset++){const candidate=palette[(start+offset)%palette.length];if(!used.has(candidate)){color=candidate;break}}colors.set(key,color);used.add(color)}
    return id=>colors.get(String(id||''))||palette[hash(id)%palette.length];
  }
  window.RiderColors={create,palette:[...palette]};
})();
