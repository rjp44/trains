std::vector<int> stationPlaces;
int watchedPlace=-1, promptPlace=-1;
std::string followedId, followTitle, followRunning;
void returnToStation() {
    followedId.clear();
    if(watchedPlace>=0) {
        auto point=places[watchedPlace].point; cx=point.x/8.f;cy=point.y/8.f;
    }
    dirty=true;
}
void selectStation(int i) {
    watchedPlace=i;promptPlace=-1;
    char code[8]={};
    if(i>=0) std::snprintf(code,sizeof(code),"%s",places[i].code);
    transport::saveView("lakes_watch",code);
    returnToStation();
}
void loadStation() {
    char code[8]="WDM"; transport::loadView("lakes_watch",code);
    stationPlaces.clear();watchedPlace=-1;
    for(size_t i=0;i<places.size();++i) {
        const auto &p=places[i];
        if(p.route<8 || std::any_of(stationPlaces.begin(),stationPlaces.end(),[&](int n){return !strcmp(p.code,places[n].code);})) continue;
        stationPlaces.push_back(i);
        if(!strcmp(code,p.code)) watchedPlace=i;
    }
}
const Vehicle *watchTrain(uint32_t now) {
    const auto &data=active(); std::vector<const Vehicle*> near;
    for(const auto &v:data.vehicles) {
        auto age=clockMs(now)-v.time;
        if(v.route<8 || age>=600000 || age< -60000) continue;
        if(!followedId.empty()) {
            if(v.id!=followedId) continue;
            cx=v.x;cy=v.y;return &v;
        }
        if(watchedPlace<0 || age>=120000 || (!replaying() && (liveFailed || !data.railOk))) continue;
        auto code=places[watchedPlace].code;
        if(v.lastCode==code || v.nextCode==code) near.push_back(&v);
    }
    if(!followedId.empty() && data.railOk && (replaying() || !liveFailed)) {
        returnToStation();return watchTrain(now);
    }
    return near.empty()?nullptr:near[(now/5000)%near.size()];
}
void watchCard(const Vehicle *v,uint32_t now) {
    const bool following=!followedId.empty();
    if(v || following) {
        int w=std::min(W-32,540),x=(W-w)/2,y=bottom-88;
        rect(x,y,w,78,edge);rect(x+1,y+1,w-2,76,paper);
        text(x+10,y+2,following?"Following":places[watchedPlace].name,muted,w-166);
        if(v) {
            followTitle=v->destination.empty()?v->label:"To "+v->destination;
            followRunning=v->next.empty()?v->last:"Next "+v->next+"  "+v->nextTime;
        }
        text(x+10,y+26,followTitle,ink,w-20);
        text(x+10,y+51,!v || (!replaying() && liveFailed) || clockMs(now)-v->time>=120000?"Last known position":followRunning,muted,w-20);
        if(following) {
            text(x+w-145,y+2,"Stop following",ink);
            hits.push_back({{x+w-152,y,152,36},StopFollowing,-1});
        } else if(v) hits.push_back({{x,y,w,78},Marker,int(v-active().vehicles.data())});
    }
    if(promptPlace>=0) {
        int x=(W-322)/2,y=(H-94)/2;
        rect(x,y,322,94,edge);rect(x+1,y+1,320,92,paper);
        text(x+12,y+8,places[promptPlace].name,ink,275);
        text(x+12,y+53,"Watch",ink);text(x+232,y+53,"Close",muted);
        hits.push_back({{x,y+42,140,50},WatchStation,promptPlace});
        hits.push_back({{x+180,y+42,142,50},Close,-1});
    }
}
