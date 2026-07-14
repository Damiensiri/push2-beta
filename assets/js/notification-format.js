(function(global){
  const TOKEN=/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*\n]+)\*\*|__([^_\n]+)__/gi;

  function appendText(container,text){
    String(text).split("\n").forEach((part,index)=>{
      if(index)container.appendChild(document.createElement("br"));
      if(part)container.appendChild(document.createTextNode(part));
    });
  }

  function render(container,value,onExternalLink){
    const text=String(value||"");
    container.replaceChildren();
    let cursor=0;
    let match;
    TOKEN.lastIndex=0;
    while((match=TOKEN.exec(text))){
      appendText(container,text.slice(cursor,match.index));
      if(match[1]&&match[2]){
        const link=document.createElement("a");
        link.textContent=match[1];
        link.href=match[2];
        link.rel="noopener noreferrer";
        const url=new URL(link.href,window.location.href);
        if(url.origin!==window.location.origin){
          link.addEventListener("click",event=>{
            event.preventDefault();
            if(onExternalLink)onExternalLink(url.href);
          });
        }
        container.appendChild(link);
      }else if(match[3]){
        const strong=document.createElement("strong");
        strong.textContent=match[3];
        container.appendChild(strong);
      }else if(match[4]){
        const underline=document.createElement("u");
        underline.textContent=match[4];
        container.appendChild(underline);
      }
      cursor=TOKEN.lastIndex;
    }
    appendText(container,text.slice(cursor));
  }

  function toPlainText(value){
    return String(value||"")
      .replace(/\[([^\]\n]+)\]\(https?:\/\/[^\s)]+\)/gi,"$1")
      .replace(/\*\*([^*\n]+)\*\*/g,"$1")
      .replace(/__([^_\n]+)__/g,"$1");
  }

  global.NotificationFormat={render,toPlainText};
})(window);
