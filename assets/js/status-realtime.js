(function(){
  const url="wss://ecurie-notifications-beta.damiensiri-pro.workers.dev/api/realtime";
  let socket=null;
  let reconnectTimer=null;
  let attempts=0;

  function connect(){
    if(document.visibilityState==="hidden"||socket?.readyState===WebSocket.OPEN)return;
    clearTimeout(reconnectTimer);
    try{
      socket=new WebSocket(url);
    }catch(error){
      scheduleReconnect();
      return;
    }
    socket.addEventListener("open",()=>{attempts=0;});
    socket.addEventListener("message",event=>{
      if(event.data==="pong")return;
      let detail={type:"all"};
      try{detail=JSON.parse(event.data);}catch(error){}
      window.dispatchEvent(new CustomEvent("pwa-data-changed",{detail}));
    });
    socket.addEventListener("close",scheduleReconnect);
    socket.addEventListener("error",()=>socket?.close());
  }

  function scheduleReconnect(){
    socket=null;
    clearTimeout(reconnectTimer);
    const delay=Math.min(1000*(2**attempts++),15000);
    reconnectTimer=setTimeout(connect,delay);
  }

  document.addEventListener("visibilitychange",()=>{
    if(document.visibilityState==="visible")connect();
  });
  window.addEventListener("online",connect);
  connect();
})();
