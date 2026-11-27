// Each signed regional layout indexes its physical SMART berths by location.
struct RegisterLocation { const char *name; unsigned first, count; };
std::vector<RegisterLocation> registerLocations;
int registerIndex = -1, registerPage = 0;
constexpr int registerColumns = 4, registerRows = 7, berthsPerPage = registerColumns * registerRows;
constexpr int registerX = 52, registerY = 121, registerPitchX = 230, registerPitchY = 53;

bool loadRegister() {
    if (!regionalLayout()) return true;
    return transport::load("locationBerths", registerLocations, [](auto p, RegisterLocation &loc) {
        return transport::row(p,loc.name,loc.first,loc.count) && loc.count > 0 &&
               loc.first < markerInfo.size() && loc.count <= markerInfo.size()-loc.first;
    }, 128);
}
bool openRegister(const char *name) {
    for (size_t i=0; i<registerLocations.size(); ++i) {
        if (strcmp(registerLocations[i].name,name)) continue;
        registerIndex = i;
        registerPage = 0;
        invalidate();
        return true;
    }
    return false;
}
void drawRegister(lv_layer_t *layer) {
    if (registerIndex < 0) return;
    const auto &loc = registerLocations[registerIndex];
    box(layer, 32, 51, 960, 510, Board, HemelEdge, 7);
    text(layer, 55, 79, 720, loc.name, 16, Text, false);
    text(layer, 54, 102, 760, "Berth register   |   Train descriptions and mapped signal indications", 12, Muted, false);
    text(layer, 933, 79, 40, "X", 16, Text);
    unsigned first = registerPage * berthsPerPage;
    for (unsigned n=0; n<berthsPerPage && first+n<loc.count; ++n) {
        const unsigned index=loc.first+first+n;
        const auto &m=markerInfo[index];
        const auto &r=current[index];
        int x=registerX+(n%registerColumns)*registerPitchX, y=registerY+(n/registerColumns)*registerPitchY;
        box(layer,x,y,218,46,Board,Edge,3);
        text(layer,x+7,y+12,106,m.id,14,Text,false);
        std::string_view track(m.track);
        auto platform=track.find(" | P");
        if(platform!=std::string_view::npos) text(layer,x+120,y+12,89,m.track+platform+3,12,Muted,false);
        text(layer,x+7,y+33,94,*r.head?r.head:"-",16,offline || r.kind==3 ? Muted : Text,false);
        if (*m.bit) {
            const char *aspect=offline || !r.aspect ? "?" : r.aspect==1 ? "ON" : "OFF";
            std::string label=std::string(m.signal)+" "+aspect;
            text(layer,x+91,y+33,119,label.c_str(),12,offline || !r.aspect ? Muted : r.aspect==1 ? On : Off);
        }
    }
    unsigned pages=(loc.count+berthsPerPage-1)/berthsPerPage;
    if (registerPage>0) text(layer,48,515,145,"< Previous",14,Text);
    if (unsigned(registerPage+1)<pages) text(layer,829,515,145,"Next >",14,Text);
    std::string position=std::to_string(registerPage+1)+" / "+std::to_string(pages);
    text(layer,402,515,220,position.c_str(),14,Muted);
}
bool registerTap(int x, int y) {
    if (registerIndex<0) return false;
    const auto &loc=registerLocations[registerIndex];
    if(x<32 || x>=992 || y<51 || y>=561 || (x>908 && y<106)) registerIndex=-1;
    else if(y>=494 && x<210 && registerPage>0) --registerPage;
    else if(y>=494 && x>815 && unsigned(registerPage+1)*berthsPerPage<loc.count) ++registerPage;
    else if(x>=registerX && y>=registerY && x<registerX+registerColumns*registerPitchX && y<registerY+registerRows*registerPitchY) {
        unsigned n=registerPage*berthsPerPage + (y-registerY)/registerPitchY*registerColumns + (x-registerX)/registerPitchX;
        if(n<loc.count) {
            unsigned i=loc.first+n;
            if(current[i].kind) chooseTrain(i,x,y);
            else if(*markerInfo[i].bit) {selected.index=i; selected.signal=true; selected.x=x; selected.y=y;}
        }
    }
    invalidate();
    return true;
}
