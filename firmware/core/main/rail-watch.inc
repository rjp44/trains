// The watched station is an app preference. The followed service lasts only for this feed session.
int watchMarker=-1;
bool expandedSector=false;
int lastFocus=-1;
bool watchChanged=true;
uint32_t watchSlot=0;
std::string freshAreas;
std::string watchKey() {
    const char *id=transport::activeApp();
    return "ws"+std::to_string(esp_rom_crc32_le(0,reinterpret_cast<const uint8_t*>(id),strlen(id)));
}
int watchNumber(const char *id) {
    if(id) for(size_t i=0;i<watchStations.size();++i) if(!strcmp(watchStations[i].id,id)) return i;
    return -1;
}
bool defaultCards() { return tracked.index<0 && (!strcmp(watchedStation(),"HML") || watchStations.empty()); }
void restoreSector() {
    if (!expandedSector) return;
    backgroundDirty=true;
    sectorScene.lines=span(viewTables[0].lines); sectorScene.labels=span(viewTables[0].labels);
    sectorScene.markers=span(viewTables[0].markers); expandedSector=false;
}
void centreStation() {
    restoreSector(); lastFocus=-1;
    if(watching<0) return;
    const auto &s=watchStations[watching];
    if(!directionalLayout() && !continuousZoom()) {
        view(!strcmp(s.id,"HML")?View::Hemel:!strcmp(s.id,"WFJ")?View::Watford:View::Sector);
        return;
    }
    if(continuousZoom() && !regionalLayout())
        view(!strcmp(s.id,"HML")?View::Hemel:!strcmp(s.id,"WFJ")?View::Watford:View::Sector);
    auto jump=[&](){
        auto &v=activeCorridor();
        for(const auto &stop:v.stations) if(!strcmp(stop.id,s.id)) {
            panTo(v.projected(stationCentre(v,stop))-v.viewportWidth()/2); return true;
        }
        return false;
    };
    if(!jump()){ view(View::Sector); jump(); }
}
void selectWatch(int n) {
    watchChanged=true; watching=n; tracked={}; watchMarker=-1; promptStation=-1;
    char saved[16]={};
    if(n>=0) std::snprintf(saved,sizeof(saved),"%s",watchStations[n].id);
    transport::saveView(watchKey().c_str(),saved);
    centreStation();
    if(n<0 && continuousZoom()) {auto &v=activeCorridor(); arrangeHeaders(v); panTo(v.pan,true);}
    invalidate();
}
void watchLocation(const char *name) {
    for(size_t i=0;i<watchStations.size();++i) if(!strcmp(watchStations[i].name,name)){selectWatch(i);return;}
}
void focusTrain(int index) {
    if(lastFocus==index) return;
    lastFocus=index;
    if(directionalLayout() || continuousZoom()) {
        auto jump=[&]() {
            auto &v=activeCorridor();
            for(const auto &m:v.markers) if(m.id==index) {panTo(v.projected(m.x)-v.viewportWidth()/2);return true;}
            return false;
        };
        if(!jump() && currentView()!=View::Sector){view(View::Sector);jump();}
        // Unassigned berths are only located to their reporting station.
        if(std::none_of(activeCorridor().markers.begin(),activeCorridor().markers.end(),[&](auto &m){return m.id==index;})){
            for(const auto &s:watchStations) if(std::find(s.markers.begin(),s.markers.end(),unsigned(index))!=s.markers.end())
                for(const auto &stop:activeCorridor().stations) if(!strcmp(s.id,stop.id)) panTo(activeCorridor().projected(stationCentre(activeCorridor(),stop))-activeCorridor().viewportWidth()/2);
        }
        return;
    }
    if(currentView()!=View::Sector) view(View::Sector);
    const auto &v=viewTables[0];
    auto at=std::find_if(v.markers.begin(),v.markers.end(),[&](auto &m){return m.id==index;});
    if(at==v.markers.end()) return;
    constexpr int margin=120;
    const int origin=std::clamp(int(at->x)-(panelWidth-margin)/4,margin,panelWidth-(panelWidth-margin)/2);
    auto project=[&](int x){return margin+2*(x-origin);};
    visibleRails.clear();visibleNames.clear();visibleBerths.clear();
    for(auto s:v.lines) {
        s.x1=project(s.x1);s.x2=project(s.x2);
        if(std::max(s.x1,s.x2)>=margin && std::min(s.x1,s.x2)<panelWidth) visibleRails.push_back(s);
    }
    for(auto l:v.labels) {
        if(l.x>=margin) {l.x=project(l.x);if(l.x<margin || l.x>=panelWidth) continue;}
        visibleNames.push_back(l);
    }
    for(auto m:v.markers){m.x=project(m.x);if(m.x>=margin && m.x<panelWidth)visibleBerths.push_back(m);}
    sectorScene.lines=span(visibleRails);sectorScene.labels=span(visibleNames);sectorScene.markers=span(visibleBerths);
    backgroundDirty=true;expandedSector=true;invalidate();
}
void stopFollow() {watchChanged=true; tracked={};watchMarker=-1;centreStation();invalidate();}
void updateWatch(uint32_t wall) {
    // Rendering runs faster than feed packets. Re-evaluate recordings and live frames
    // immediately, and only rotate an unchanged station card once per time slot.
    auto slot=wall/5000;
    if(!watchChanged && slot==watchSlot) return;
    watchSlot=slot; watchChanged=false;
    int next=-1;
    if(tracked.index>=0) {
        auto wasPresent=tracked.present;
        trackSelection(tracked,true);
        if(tracked.present) focusTrain(tracked.index);
        else if(!offline && (!liveMode || feedStatus==1 || freshAreas.find(" "+std::string(markerInfo[tracked.index].id,2)+" ")!=std::string::npos)) stopFollow();
        if(wasPresent!=tracked.present) invalidate();
    }
    if(tracked.index<0 && watching>=0 && !offline && !defaultCards()) {
        std::vector<unsigned> candidates;
        for(auto i:watchStations[watching].markers) if(current[i].kind==1 &&
            std::none_of(candidates.begin(),candidates.end(),[&](auto j){return !strcmp(current[i].head,current[j].head) && !strcmp(current[i].detail.service,current[j].detail.service);}))
            candidates.push_back(i);
        if(!candidates.empty()) next=candidates[(wall/5000)%candidates.size()];
    }
    if(watchMarker!=next){watchMarker=next;invalidate();}
}
constexpr Rect promptBox{338,189,348,95};
Rect watchBounds() {
    Rect box{288,491,448,72};
    if (!tracked.present) return box;
    for (const auto &marker : scene->markers) {
        if (marker.id != tracked.index) continue;
        const int halfWidth = scene->badgeWidth / 2 + 3, halfHeight = scene->badgeHeight / 2 + 3;
        if (marker.x + halfWidth >= box.x && marker.x - halfWidth < box.x + box.w &&
            marker.y + halfHeight >= box.y && marker.y - halfHeight < box.y + box.h)
            box.y = marker.y - halfHeight - 8 - box.h;
        break;
    }
    return box;
}
void drawWatch(lv_layer_t *layer) {
    bool follow=tracked.index>=0;
    if(follow || watchMarker>=0) {
        const auto b=watchBounds();
        auto r=follow ? tracked.route.c_str():current[watchMarker].detail.route;
        auto state=follow ? tracked.running.c_str():current[watchMarker].detail.running;
        box(layer,b.x,b.y,b.w,b.h,HemelBand,HemelEdge,5);
        text(layer,b.x+10,b.y+13,70,follow ? tracked.head.c_str():current[watchMarker].head,16,Text,false);
        text(layer,b.x+86,b.y+13,b.w-210,follow ? "Following":watchStations[watching].name,14,Muted,false);
        if(follow) text(layer,b.x+b.w-128,b.y+13,119,"Stop following",14,Text);
        text(layer,b.x+10,b.y+36,b.w-20,*r?r:"Service details unavailable",16,Text,false);
        text(layer,b.x+10,b.y+57,b.w-20,(follow && (offline || !tracked.present || current[tracked.index].kind==3))?"Last known position":state,12,Muted,false);
    }
    if(promptStation>=0 && size_t(promptStation)<watchStations.size()) {
        auto b=promptBox;
        box(layer,b.x,b.y,b.w,b.h,Board,HemelEdge,5);
        text(layer,b.x+12,b.y+23,b.w-64,watchStations[promptStation].name,16,Text,false);
        text(layer,b.x+b.w-40,b.y+23,32,"X",14,Text);
        text(layer,b.x+10,b.y+64,100,"Watch",16,Text);
        if(!strcmp(watchStations[promptStation].id,"HML") || !strcmp(watchStations[promptStation].id,"WFJ"))
            text(layer,b.x+152,b.y+64,132,"Zoom here",14,Text);
    }
}
bool watchTap(int x,int y) {
    if(promptStation>=0) {
        int n=promptStation;promptStation=-1;
        if(promptBox.contains(x,y) && y>promptBox.y+43){
            if(x<promptBox.x+140) selectWatch(n);
            else {
                auto id=watchStations[n].id;
                if(!strcmp(id,"HML") || !strcmp(id,"WFJ")) {
                    view(!strcmp(id,"HML") ? View::Hemel : View::Watford);
                    if(continuousZoom()) {
                        stepZoom(0);
                        auto &v=activeCorridor();
                        panTo(v.projected(v.focus)-v.viewportWidth()/2);
                    }
                }
            }
        }
        invalidate(); return true;
    }
    const auto b=watchBounds();
    if((tracked.index>=0 || watchMarker>=0) && b.contains(x,y)){
        if(tracked.index>=0 && x>b.x+b.w-137 && y<b.y+34) stopFollow();
        else if(watchMarker>=0) chooseTrain(watchMarker,x,y);
        return true;
    }
    return false;
}
