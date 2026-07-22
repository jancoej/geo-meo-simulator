const viewer = new Cesium.Viewer("cesiumContainer", {
  animation:false,timeline:false,geocoder:false,homeButton:true,sceneModePicker:false,
  navigationHelpButton:false,fullscreenButton:true,baseLayerPicker:true,infoBox:false,selectionIndicator:false
});
viewer.scene.backgroundColor=Cesium.Color.BLACK;
viewer.scene.globe.show=true;
viewer.scene.globe.baseColor=Cesium.Color.DARKSLATEBLUE;
viewer.scene.globe.enableLighting=true;

const GEO_ALTITUDE_M=35786000;
const MEO_ALTITUDE_M=8063000;

const regionProfiles={
  europe:{label:"Europe",lon:8,lat:49,spreadLon:20,spreadLat:10},
  africa:{label:"Africa",lon:20,lat:4,spreadLon:26,spreadLat:20},
  americas:{label:"Americas",lon:-75,lat:17,spreadLon:34,spreadLat:26},
  middleeast:{label:"Middle East",lon:45,lat:25,spreadLon:18,spreadLat:12},
  asia:{label:"Asia-Pacific",lon:110,lat:15,spreadLon:35,spreadLat:24}
};

const orbitProfiles={
  GEO:{name:"GEO",title:"GEO Wide-Area Connectivity",altitudeM:GEO_ALTITUDE_M,slantRangeKm:39000,estimatedRttMs:590,availability:99.95,commercialIndex:1.00,
    satelliteEirp:{C:45,Ku:52,Ka:54},satelliteGt:{C:10,Ku:14,Ka:16},
    architectureReason:"Broad regional coverage, efficient point-to-multipoint delivery, and strong fit for multicast, broadcast, and widely distributed sites.",
    flow:["Customer Sites","VSAT","GEO","Teleport","IP / Cloud"]},
  MEO:{name:"MEO",title:"MEO Low-Latency Connectivity",altitudeM:MEO_ALTITUDE_M,slantRangeKm:13500,estimatedRttMs:135,availability:99.75,commercialIndex:1.15,
    satelliteEirp:{C:47,Ku:54,Ka:57},satelliteGt:{C:13,Ku:17,Ka:20},
    architectureReason:"Lower-latency satellite connectivity for cloud access, real-time enterprise applications, voice, and interactive services.",
    flow:["Customer Sites","VSAT","MEO","Gateway","Cloud / HQ"]},
  HYBRID:{name:"HYBRID",title:"Hybrid GEO + MEO Resilient Network",altitudeM:MEO_ALTITUDE_M,slantRangeKm:13500,estimatedRttMs:155,availability:99.99,commercialIndex:1.36,
    satelliteEirp:{C:47,Ku:54,Ka:57},satelliteGt:{C:13,Ku:17,Ka:20},
    architectureReason:"MEO for primary low-latency traffic with GEO diversity for continuity, multicast, overflow, and service resilience.",
    flow:["Customer Sites","VSAT","MEO Primary","GEO Diversity","Dual Gateways","Cloud / HQ"]}
};

const bandProfiles={
  C:{uplinkGHz:6.0,downlinkGHz:4.0,efficiency:.64,baseRainDb:.6},
  Ku:{uplinkGHz:14.0,downlinkGHz:12.0,efficiency:.62,baseRainDb:2.3},
  Ka:{uplinkGHz:29.0,downlinkGHz:19.7,efficiency:.58,baseRainDb:5.2}
};

const serviceState={architecture:"MEO",recommendation:"MEO",geoLongitude:18,meoBaseLongitude:-30,siteEntities:[],linkEntities:[],coverageEntities:[],satelliteEntities:[],orbitEntities:[]};

function clamp(v,min,max){return Math.min(Math.max(v,min),max)}
function numberValue(id,fallback=0){const v=Number(document.getElementById(id).value);return Number.isFinite(v)?v:fallback}
function inputChecked(id){return document.getElementById(id).checked}
function db(v){return 10*Math.log10(Math.max(v,1e-12))}
function wavelengthMeters(fGHz){return .299792458/fGHz}
function antennaGainDbi(diameterM,frequencyGHz,efficiency=.62){const lambda=wavelengthMeters(frequencyGHz);return db(efficiency*Math.pow(Math.PI*diameterM/lambda,2))}
function fsplDb(distanceKm,frequencyGHz){return 92.45+20*Math.log10(distanceKm)+20*Math.log10(frequencyGHz)}
function availabilityFadeDb(band,availabilityTarget){const base=bandProfiles[band].baseRainDb;const severity=1+Math.max(0,availabilityTarget-99.5)*2.8;return base*severity}
function terminalSystemGt(diameterM,downlinkGHz){const gain=antennaGainDbi(diameterM,downlinkGHz);const temp=downlinkGHz>=18?210:downlinkGHz>=10?155:115;return gain-db(temp)}

function collectRequirements(){return{
  opportunity:document.getElementById("opportunityName").value.trim()||"Customer Opportunity",
  segment:document.getElementById("customerSegment").value,
  region:document.getElementById("serviceRegion").value,
  sites:clamp(Math.round(numberValue("siteCount",1)),1,500),
  downlinkMbps:clamp(numberValue("downlinkMbps",1),1,1000),
  uplinkMbps:clamp(numberValue("uplinkMbps",1),1,500),
  growthFactor:numberValue("trafficGrowth",1.25),latencySensitivity:document.getElementById("latencySensitivity").value,
  availabilityTarget:numberValue("availabilityTarget",99.9),voip:inputChecked("needsVoip"),ipsec:inputChecked("needsIpsec"),
  multicast:inputChecked("needsMulticast"),qos:inputChecked("needsQos"),band:document.getElementById("frequencyBand").value,
  antennaDiameterM:numberValue("antennaDiameter",1.2),hpaPowerW:numberValue("hpaPower",4),architectureOverride:document.getElementById("architectureOverride").value
}}

function recommendArchitecture(r){
  if(r.architectureOverride!=="AUTO")return r.architectureOverride;
  let geo=0,meo=0,hybrid=0;
  if(r.latencySensitivity==="high")meo+=38;if(r.latencySensitivity==="medium")meo+=23;if(r.latencySensitivity==="low")geo+=25;
  if(r.multicast)geo+=27;if(r.voip)meo+=16;if(r.sites>=60)geo+=17;if(r.downlinkMbps>=150)meo+=13;
  if(r.segment==="broadcast")geo+=35;if(r.segment==="cellular")meo+=25;if(r.segment==="government")hybrid+=26;if(r.segment==="maritime")meo+=15;
  if(r.availabilityTarget>=99.99)hybrid+=55;else if(r.availabilityTarget>=99.95)hybrid+=30;
  hybrid+=Math.max(geo,meo)*.62;
  return Object.entries({GEO:geo,MEO:meo,HYBRID:hybrid}).sort((a,b)=>b[1]-a[1])[0][0]
}

function chooseModulation(ebno){
  if(ebno>=13.2)return{name:"16APSK",efficiency:2.75,requiredEbNo:10.4,coding:"FEC 3/4"};
  if(ebno>=9.2)return{name:"8PSK",efficiency:2.05,requiredEbNo:7.4,coding:"FEC 3/4"};
  return{name:"QPSK",efficiency:1.25,requiredEbNo:3.5,coding:"FEC 1/2"}
}

function calculateLinkBudget(r,architecture){
  const orbit=orbitProfiles[architecture],band=bandProfiles[r.band];
  const totalDl=r.sites*r.downlinkMbps*r.growthFactor,totalUl=r.sites*r.uplinkMbps*r.growthFactor;
  const gainUl=antennaGainDbi(r.antennaDiameterM,band.uplinkGHz),terminalEirp=db(r.hpaPowerW)+gainUl-1.2;
  const rain=availabilityFadeDb(r.band,r.availabilityTarget),otherLoss=1.4;
  const ulPath=fsplDb(orbit.slantRangeKm,band.uplinkGHz),dlPath=fsplDb(orbit.slantRangeKm,band.downlinkGHz);
  const ulCn0=terminalEirp+orbit.satelliteGt[r.band]-ulPath-rain-otherLoss+228.6;
  const terminalGt=terminalSystemGt(r.antennaDiameterM,band.downlinkGHz);
  const dlCn0=orbit.satelliteEirp[r.band]+terminalGt-dlPath-rain-otherLoss+228.6;
  const ulEbNo=ulCn0-db(totalUl*1e6),dlEbNo=dlCn0-db(totalDl*1e6),limiting=Math.min(ulEbNo,dlEbNo);
  const modulation=chooseModulation(limiting),ulMargin=ulEbNo-modulation.requiredEbNo,dlMargin=dlEbNo-modulation.requiredEbNo;
  const protectedCapacityMbps=Math.max(totalDl,totalUl)*1.08,bandwidthMHz=protectedCapacityMbps/(modulation.efficiency*band.efficiency);
  return{terminalEirp,terminalGt,rainFade:rain,uplinkPathLoss:ulPath,downlinkPathLoss:dlPath,pathLoss:Math.max(ulPath,dlPath),uplinkEbNo:ulEbNo,downlinkEbNo:dlEbNo,uplinkMargin:ulMargin,downlinkMargin:dlMargin,protectedCapacityMbps,bandwidthMHz,modulation}
}

function calculateSolutionFit(r,architecture,b){
  const orbit=orbitProfiles[architecture];let score=100;const margin=Math.min(b.uplinkMargin,b.downlinkMargin);
  if(margin<0)score-=36;else if(margin<2)score-=18;else if(margin<4)score-=8;
  if(r.latencySensitivity==="high"&&architecture==="GEO")score-=28;if(r.multicast&&architecture==="MEO")score-=8;
  if(r.availabilityTarget>orbit.availability&&architecture!=="HYBRID")score-=20;if(r.availabilityTarget>=99.99&&architecture==="HYBRID")score+=4;
  if(r.qos)score+=2;if(r.ipsec)score+=2;return Math.round(clamp(score,20,99))
}

function estimateCommercials(r,architecture,b){
  const orbit=orbitProfiles[architecture],capacityGbps=b.protectedCapacityMbps/1000;
  const regionFactor={europe:1.05,africa:1.12,americas:1,middleeast:1.08,asia:1.10}[r.region];
  const serviceFactor=1+(r.ipsec?.03:0)+(r.qos?.05:0)+(r.voip?.02:0)+(r.multicast?.025:0);
  return{capacityGbps,commercialIndex:orbit.commercialIndex,illustrativeMrc:capacityGbps*47500*orbit.commercialIndex*regionFactor*serviceFactor}
}

function segmentLabel(v){return{enterprise:"enterprise connectivity",cellular:"cellular backhaul",broadcast:"broadcast and multicast distribution",government:"critical government communications",maritime:"maritime and mobile connectivity"}[v]}
function architectureServiceText(r,a){const services=[];if(r.qos)services.push("application-aware QoS");if(r.ipsec)services.push("IPsec encryption");if(r.voip)services.push("voice prioritization");if(r.multicast)services.push("multicast optimization");if(!services.length)services.push("managed IP connectivity");return`${orbitProfiles[a].architectureReason} The service design includes ${services.join(", ")}.`}
function feasibilityState(b){const m=Math.min(b.uplinkMargin,b.downlinkMargin);return m>=3?{text:"FEASIBLE",className:"nominal"}:m>=0?{text:"REVIEW REQUIRED",className:"warning"}:{text:"NOT FEASIBLE",className:"critical"}}

function updateHeader(r,b){const s=feasibilityState(b);headerOpportunity.textContent=r.opportunity;solutionStatus.textContent=s.text;solutionStatusDot.className=`status-dot ${s.className}`}
function updateArchitecturePanel(r,a){const o=orbitProfiles[a];architectureTitle.textContent=o.title;architectureReason.textContent=architectureServiceText(r,a);architectureFlow.innerHTML=o.flow.map((x,i)=>`${i?"<b>→</b>":""}<span>${x}</span>`).join("");selectedOrbit.textContent=a==="HYBRID"?"GEO + MEO":a;mapLatency.textContent=`${o.estimatedRttMs} ms`;mapSites.textContent=r.sites;mapRegion.textContent=regionProfiles[r.region].label}

function updateBudgetPanel(r,a,b){
  const band=bandProfiles[r.band];
  function setMargin(valueId,statusId,v){const ve=document.getElementById(valueId),se=document.getElementById(statusId);ve.textContent=`${v.toFixed(1)} dB`;if(v>=3){ve.className="good";se.textContent="Feasible";se.className="good"}else if(v>=0){ve.className="warn";se.textContent="Engineering review";se.className="warn"}else{ve.className="bad";se.textContent="Insufficient";se.className="bad"}}
  setMargin("uplinkMargin","uplinkStatus",b.uplinkMargin);setMargin("downlinkMargin","downlinkStatus",b.downlinkMargin);
  requiredBandwidth.textContent=b.bandwidthMHz>=1000?`${(b.bandwidthMHz/1000).toFixed(2)} GHz`:`${b.bandwidthMHz.toFixed(0)} MHz`;
  modulation.textContent=b.modulation.name;coding.textContent=b.modulation.coding;uplinkFrequency.textContent=`${band.uplinkGHz.toFixed(2)} GHz`;downlinkFrequency.textContent=`${band.downlinkGHz.toFixed(2)} GHz`;terminalEirp.textContent=`${b.terminalEirp.toFixed(1)} dBW`;pathLoss.textContent=`${b.pathLoss.toFixed(1)} dB`;weatherAllowance.textContent=`${b.rainFade.toFixed(1)} dB`
}

function updateCommercialPanel(r,a,b,fit){
  const c=estimateCommercials(r,a,b);solutionFit.textContent=fit;protectedCapacity.textContent=c.capacityGbps>=1?`${c.capacityGbps.toFixed(2)} Gbps`:`${(c.capacityGbps*1000).toFixed(0)} Mbps`;commercialIndex.textContent=`${c.commercialIndex.toFixed(2)}×`;
  illustrativeMrc.textContent=`€${(Math.round(c.illustrativeMrc/500)*500).toLocaleString("en-US")}`;
  growthOpportunity.textContent=r.growthFactor>=1.5||r.sites>=40||r.downlinkMbps>=150?"High":r.growthFactor>=1.25?"Medium":"Moderate";drawFitGauge(fit)
}

function updateCrm(r,fit,b){const margin=Math.min(b.uplinkMargin,b.downlinkMargin),p=Math.round(clamp(35+fit*.45+(margin>=3?10:0),25,90));crmStage.textContent=fit>=80?"Proposal development":"Solution validation";winProbability.textContent=`${p}%`;decisionHorizon.textContent=r.sites>=50?"120 days":"90 days";nextAction.textContent=margin>=3?"Present solution and value case":"Refine terminal or capacity design"}

function proposalTextFor(r,a,b,fit){
  const o=orbitProfiles[a],margin=Math.min(b.uplinkMargin,b.downlinkMargin),features=[r.qos?"QoS":null,r.ipsec?"IPsec":null,r.voip?"VoIP prioritization":null,r.multicast?"multicast":null].filter(Boolean).join(", ");
  const technical=margin>=3?"The preliminary link budget provides appropriate engineering margin.":margin>=0?"The preliminary link budget is feasible but requires detailed optimization.":"The current terminal and capacity assumptions require redesign before proposal submission.";
  return`CUSTOMER OPPORTUNITY\n${r.opportunity}\n\nCUSTOMER NEED\nThe customer requires ${segmentLabel(r.segment)} across ${r.sites} site(s) in ${regionProfiles[r.region].label}, with ${r.downlinkMbps} Mbps downlink and ${r.uplinkMbps} Mbps uplink per site. The design includes ${Math.round((r.growthFactor-1)*100)}% traffic growth and a target availability of ${r.availabilityTarget.toFixed(2)}%.\n\nRECOMMENDED SOLUTION\n${o.title}. ${architectureServiceText(r,a)}\n\nTECHNICAL FEASIBILITY\nProtected capacity: ${(b.protectedCapacityMbps/1000).toFixed(2)} Gbps\nEstimated RTT: ${o.estimatedRttMs} ms\nRF band: ${r.band}-band\nTerminal: ${r.antennaDiameterM.toFixed(2)} m VSAT with ${r.hpaPowerW} W HPA\nModulation: ${b.modulation.name}, ${b.modulation.coding}\nUplink margin: ${b.uplinkMargin.toFixed(1)} dB\nDownlink margin: ${b.downlinkMargin.toFixed(1)} dB\n${technical}\n\nIP SERVICE DESIGN\n${features||"Managed IP connectivity"} will be incorporated into the end-to-end design. Traffic classes should be validated with the customer, including real-time, critical, business, and best-effort flows.\n\nCUSTOMER VALUE\nThe proposed architecture balances application performance, regional coverage, resilience, and scalable capacity. The current solution-fit score is ${fit}/100.\n\nNEXT STEPS\n1. Confirm traffic profiles, busy-hour assumptions, and site coordinates.\n2. Validate detailed link budgets with the Link Engineering team.\n3. Confirm gateway diversity, routing, QoS, security, and service demarcation.\n4. Prepare the technical proposal, implementation plan, and commercial quotation.\n5. Record customer actions, risks, and decision milestones in the CRM opportunity.\n\nPORTFOLIO DISCLAIMER\nThis is an illustrative engineering simulator and not an official SES design, quotation, coverage commitment, or engineering tool.`
}

function updateProposal(r,a,b,fit){proposalText.textContent=proposalTextFor(r,a,b,fit)}

function drawFitGauge(score){const c=fitGauge,ctx=c.getContext("2d"),w=c.width,h=c.height;ctx.clearRect(0,0,w,h);ctx.lineCap="round";const x=w/2,y=h-8,r=68,start=Math.PI;ctx.strokeStyle="rgba(255,255,255,.08)";ctx.lineWidth=14;ctx.beginPath();ctx.arc(x,y,r,start,2*Math.PI);ctx.stroke();ctx.strokeStyle=score>=80?"#3ce29a":score>=60?"#ffc857":"#ff6262";ctx.beginPath();ctx.arc(x,y,r,start,start+Math.PI*(score/100));ctx.stroke();ctx.fillStyle="#8ea7bb";ctx.font="10px Arial";ctx.textAlign="center";ctx.fillText("CUSTOMER / TECHNICAL / COMMERCIAL FIT",x,18)}
function architectureScores(r,a,b){const o=orbitProfiles[a],margin=Math.min(b.uplinkMargin,b.downlinkMargin);const latency=a==="GEO"?42:a==="MEO"?92:86;const availability=a==="HYBRID"?99:a==="GEO"?91:84;const technical=clamp(65+margin*5,20,98);const useCase=recommendArchitecture({...r,architectureOverride:"AUTO"})===a?94:a==="HYBRID"?83:70;const commercial=Math.round(clamp(100-(o.commercialIndex-1)*70,55,100));return{latency,availability,technical,useCase,commercial}}

function drawComparison(r){const c=comparisonChart,ctx=c.getContext("2d"),w=c.width,h=c.height;ctx.clearRect(0,0,w,h);ctx.fillStyle="#071421";ctx.fillRect(0,0,w,h);const archs=["GEO","MEO","HYBRID"],labels=["Latency","Availability","RF feasibility","Use-case fit","Commercial"],left=115,top=24,barH=9,maxW=w-left-80;ctx.font="10px Arial";ctx.textBaseline="middle";labels.forEach((label,i)=>{const y=top+i*31;ctx.fillStyle="#8ea7bb";ctx.textAlign="right";ctx.fillText(label,left-12,y+1);ctx.fillStyle="rgba(255,255,255,.06)";ctx.fillRect(left,y-barH/2,maxW,barH)});const colors={GEO:"#6fe978",MEO:"#5bd6ff",HYBRID:"#ffc857"};archs.forEach((a,ai)=>{const b=calculateLinkBudget(r,a),s=architectureScores(r,a,b),vals=[s.latency,s.availability,s.technical,s.useCase,s.commercial],offset=(ai-1)*3;vals.forEach((v,i)=>{const y=top+i*31+offset;ctx.fillStyle=colors[a];ctx.globalAlpha=a===serviceState.architecture?1:.58;ctx.fillRect(left,y-2,maxW*(v/100),4)});ctx.globalAlpha=1;ctx.fillStyle=colors[a];ctx.textAlign="left";ctx.font="bold 10px Arial";ctx.fillText(a,left+ai*70,h-14)})}

function clearMapEntities(){[...serviceState.siteEntities,...serviceState.linkEntities,...serviceState.coverageEntities,...serviceState.satelliteEntities,...serviceState.orbitEntities].forEach(e=>viewer.entities.remove(e));serviceState.siteEntities=[];serviceState.linkEntities=[];serviceState.coverageEntities=[];serviceState.satelliteEntities=[];serviceState.orbitEntities=[]}
function orbitPositions(altitudeM,inclinationDeg=0,phaseDeg=0){const p=[];for(let lon=-180;lon<=180;lon+=2){const lat=inclinationDeg*Math.sin(Cesium.Math.toRadians(lon+phaseDeg));p.push(Cesium.Cartesian3.fromDegrees(lon,lat,altitudeM))}return p}
function addOrbit(name,alt,color,inc,phase,opacity=.72,width=2.5){const e=viewer.entities.add({name,polyline:{positions:orbitPositions(alt,inc,phase),width,material:color.withAlpha(opacity),arcType:Cesium.ArcType.NONE}});serviceState.orbitEntities.push(e)}
function addSatellite(name,position,color,labelText,scale=1,opacity=1){const e=viewer.entities.add({name,position,billboard:{image:"./satellite.png",width:40*scale,height:40*scale,color:Cesium.Color.WHITE.withAlpha(opacity),disableDepthTestDistance:Number.POSITIVE_INFINITY},label:{text:labelText,font:"bold 12px Arial",fillColor:color.withAlpha(Math.max(opacity,.38)),outlineColor:Cesium.Color.BLACK,outlineWidth:3,style:Cesium.LabelStyle.FILL_AND_OUTLINE,showBackground:true,backgroundColor:Cesium.Color.BLACK.withAlpha(.72),pixelOffset:new Cesium.Cartesian2(0,-38),disableDepthTestDistance:Number.POSITIVE_INFINITY,scale:opacity<.6?.82:1}});serviceState.satelliteEntities.push(e);return e}
function addCoverage(position,radiusM,color,fillOpacity=.08,outlineOpacity=.65){const e=viewer.entities.add({position,ellipse:{semiMajorAxis:radiusM,semiMinorAxis:radiusM,material:color.withAlpha(fillOpacity),outline:true,outlineColor:color.withAlpha(outlineOpacity),height:5000}});serviceState.coverageEntities.push(e)}
function regionSiteCoordinates(regionKey,siteCount){const p=regionProfiles[regionKey],count=Math.min(siteCount,18),coords=[];for(let i=0;i<count;i++){const angle=i*2.3999632297,r=Math.sqrt((i+1)/count),lon=p.lon+Math.cos(angle)*p.spreadLon*r,lat=p.lat+Math.sin(angle)*p.spreadLat*r;coords.push({lon,lat:clamp(lat,-72,72)})}return coords}
function addCustomerSites(r){const sites=regionSiteCoordinates(r.region,r.sites);sites.forEach((s,i)=>{const pos=Cesium.Cartesian3.fromDegrees(s.lon,s.lat,0),e=viewer.entities.add({name:`Customer Site ${i+1}`,position:pos,point:{pixelSize:i===0?11:7,color:Cesium.Color.fromCssColorString("#ffc857"),outlineColor:Cesium.Color.BLACK,outlineWidth:2,disableDepthTestDistance:Number.POSITIVE_INFINITY},label:{text:i===0?"PRIMARY CUSTOMER SITE":"",font:"bold 11px Arial",fillColor:Cesium.Color.fromCssColorString("#ffc857"),outlineColor:Cesium.Color.BLACK,outlineWidth:3,style:Cesium.LabelStyle.FILL_AND_OUTLINE,pixelOffset:new Cesium.Cartesian2(0,-18),disableDepthTestDistance:Number.POSITIVE_INFINITY}});serviceState.siteEntities.push(e)});return sites}
function addLink(start,end,color,dashed=false){const material=dashed?new Cesium.PolylineDashMaterialProperty({color,dashLength:12}):color,e=viewer.entities.add({polyline:{positions:[start,end],width:3,material}});serviceState.linkEntities.push(e)}

function renderNetwork(r,a){
  clearMapEntities();

  const sites=addCustomerSites(r);
  const primary=Cesium.Cartesian3.fromDegrees(sites[0].lon,sites[0].lat,0);
  const region=regionProfiles[r.region];
  const geoActive=a==="GEO"||a==="HYBRID";
  const meoActive=a==="MEO"||a==="HYBRID";

  // Always display the GEO option. It is bright when selected and muted
  // when it is only an alternative architecture.
  const geoColor=Cesium.Color.LIME;
  const geoPos=Cesium.Cartesian3.fromDegrees(
    serviceState.geoLongitude,
    0,
    GEO_ALTITUDE_M
  );

  addOrbit(
    "GEO Orbit",
    GEO_ALTITUDE_M,
    geoColor,
    0,
    0,
    geoActive?.82:.24,
    geoActive?3.2:1.6
  );

  addSatellite(
    "GEO Solution Satellite",
    geoPos,
    geoColor,
    geoActive
      ?(a==="HYBRID"?"GEO DIVERSITY":"GEO PRIMARY")
      :"GEO OPTION",
    geoActive?1.10:.82,
    geoActive?1:.44
  );

  addCoverage(
    Cesium.Cartesian3.fromDegrees(serviceState.geoLongitude,0,0),
    7000000,
    geoColor,
    geoActive?.10:.025,
    geoActive?.72:.24
  );

  if(geoActive){
    addLink(primary,geoPos,geoColor,a==="HYBRID");
  }

  // Always display the MEO constellation. It is emphasized only when
  // the MEO path forms part of the recommended solution.
  addOrbit(
    "MEO Plane A",
    MEO_ALTITUDE_M,
    Cesium.Color.CYAN,
    28,
    0,
    meoActive?.78:.20,
    meoActive?2.8:1.5
  );
  addOrbit(
    "MEO Plane B",
    MEO_ALTITUDE_M,
    Cesium.Color.CYAN,
    28,
    90,
    meoActive?.78:.20,
    meoActive?2.8:1.5
  );

  // Six MEO satellites distributed consistently across two planes:
  // Plane A: MEO-1, MEO-3, MEO-5
  // Plane B: MEO-2, MEO-4, MEO-6
  for(let i=0;i<6;i++){
    const planeName=i%2===0?"A":"B";
    const planePhaseDeg=planeName==="A"?0:90;
    const slotInPlane=Math.floor(i/2);

    // Three satellites per plane, separated by 120 degrees.
    // Plane B is offset by 60 degrees in longitude.
    const planeLongitudeOffsetDeg=planeName==="A"?0:60;
    const lon=(
      (
        serviceState.meoBaseLongitude+
        slotInPlane*120+
        planeLongitudeOffsetDeg+
        180
      )%360
    )-180;

    const lat=28*Math.sin(
      Cesium.Math.toRadians(lon+planePhaseDeg)
    );

    const pos=Cesium.Cartesian3.fromDegrees(
      lon,
      lat,
      MEO_ALTITUDE_M
    );

    const isPrimary=i===0;
    const satelliteLabel=meoActive
      ?(
          isPrimary
            ?"MEO PRIMARY\nPLANE A"
            :`MEO-${i+1}\nPLANE ${planeName}`
        )
      :`MEO-${i+1} OPTION\nPLANE ${planeName}`;

    addSatellite(
      `MEO-${i+1}`,
      pos,
      Cesium.Color.CYAN,
      satelliteLabel,
      meoActive?(isPrimary?1.05:.78):.66,
      meoActive?1:.34
    );

    addCoverage(
      Cesium.Cartesian3.fromDegrees(lon,lat,0),
      3200000,
      Cesium.Color.CYAN,
      meoActive?.075:.018,
      meoActive?.58:.18
    );

    if(meoActive&&isPrimary){
      addLink(primary,pos,Cesium.Color.CYAN);
    }
  }

  const gatewayPos=Cesium.Cartesian3.fromDegrees(
    region.lon+7,
    region.lat+4,
    0
  );

  const gateway=viewer.entities.add({
    name:"Regional Gateway",
    position:gatewayPos,
    point:{
      pixelSize:12,
      color:Cesium.Color.ORANGE,
      outlineColor:Cesium.Color.BLACK,
      outlineWidth:2,
      disableDepthTestDistance:Number.POSITIVE_INFINITY
    },
    label:{
      text:"REGIONAL GATEWAY",
      font:"bold 11px Arial",
      fillColor:Cesium.Color.ORANGE,
      outlineColor:Cesium.Color.BLACK,
      outlineWidth:3,
      style:Cesium.LabelStyle.FILL_AND_OUTLINE,
      pixelOffset:new Cesium.Cartesian2(0,-20),
      disableDepthTestDistance:Number.POSITIVE_INFINITY
    }
  });

  serviceState.siteEntities.push(gateway);
  addLink(primary,gatewayPos,Cesium.Color.ORANGE,true);

  // Use a constellation-level view so GEO remains visible even when
  // MEO is the recommended architecture.
  document.querySelectorAll(".map-toolbar button").forEach(
    button=>button.classList.remove("active")
  );
  document.getElementById("showAllBtn").classList.add("active");

  viewer.camera.flyTo({
    destination:Cesium.Cartesian3.fromDegrees(
      region.lon,
      region.lat+9,
      85000000
    ),
    duration:1.6
  });
}

function drawCurrentSolution(){const r=collectRequirements();serviceState.recommendation=recommendArchitecture(r);serviceState.architecture=serviceState.recommendation;const b=calculateLinkBudget(r,serviceState.architecture),fit=calculateSolutionFit(r,serviceState.architecture,b);updateHeader(r,b);updateArchitecturePanel(r,serviceState.architecture);updateBudgetPanel(r,serviceState.architecture,b);updateCommercialPanel(r,serviceState.architecture,b,fit);updateCrm(r,fit,b);updateProposal(r,serviceState.architecture,b,fit);drawComparison(r);renderNetwork(r,serviceState.architecture)}
function forceArchitecture(a){architectureOverride.value=a;drawCurrentSolution()}
function downloadProposal(){const r=collectRequirements(),content=proposalText.textContent,blob=new Blob([content],{type:"text/plain;charset=utf-8"}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=`${r.opportunity.replace(/[^a-z0-9]+/gi,"-").toLowerCase()}-solution-summary.txt`;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url)}
async function copyProposal(){try{await navigator.clipboard.writeText(proposalText.textContent);copyProposalBtn.textContent="Copied";setTimeout(()=>copyProposalBtn.textContent="Copy",1300)}catch(e){alert("Copy was blocked by the browser. Select the proposal text manually.")}}

analyzeBtn.addEventListener("click",drawCurrentSolution);calculateBtn.addEventListener("click",drawCurrentSolution);selectGeoBtn.addEventListener("click",()=>forceArchitecture("GEO"));selectMeoBtn.addEventListener("click",()=>forceArchitecture("MEO"));selectHybridBtn.addEventListener("click",()=>forceArchitecture("HYBRID"));downloadProposalBtn.addEventListener("click",downloadProposal);copyProposalBtn.addEventListener("click",copyProposal);
showAllBtn.addEventListener("click",()=>{document.querySelectorAll(".map-toolbar button").forEach(b=>b.classList.remove("active"));showAllBtn.classList.add("active");viewer.camera.flyTo({destination:Cesium.Cartesian3.fromDegrees(10,18,85000000),duration:1.7})});
showGeoBtn.addEventListener("click",()=>{document.querySelectorAll(".map-toolbar button").forEach(b=>b.classList.remove("active"));showGeoBtn.classList.add("active");viewer.camera.flyTo({destination:Cesium.Cartesian3.fromDegrees(serviceState.geoLongitude,12,72000000),duration:1.7})});
showMeoBtn.addEventListener("click",()=>{document.querySelectorAll(".map-toolbar button").forEach(b=>b.classList.remove("active"));showMeoBtn.classList.add("active");viewer.camera.flyTo({destination:Cesium.Cartesian3.fromDegrees(serviceState.meoBaseLongitude,20,26000000),duration:1.7})});
showCustomerBtn.addEventListener("click",()=>{document.querySelectorAll(".map-toolbar button").forEach(b=>b.classList.remove("active"));showCustomerBtn.classList.add("active");const region=regionProfiles[collectRequirements().region];viewer.camera.flyTo({destination:Cesium.Cartesian3.fromDegrees(region.lon,region.lat+4,6500000),duration:1.7})});

["opportunityName","customerSegment","serviceRegion","siteCount","trafficGrowth","downlinkMbps","uplinkMbps","latencySensitivity","availabilityTarget","needsVoip","needsIpsec","needsMulticast","needsQos","frequencyBand","antennaDiameter","hpaPower","architectureOverride"].forEach(id=>document.getElementById(id).addEventListener("change",()=>{if(id==="opportunityName")headerOpportunity.textContent=opportunityName.value||"Customer Opportunity"}));

viewer.camera.setView({destination:Cesium.Cartesian3.fromDegrees(10,18,85000000)});
drawCurrentSolution();
