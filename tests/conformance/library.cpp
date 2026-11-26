#include "../../firmware/core/main/library.h"
#include "../../firmware/core/main/version.h"
#include <cstdlib>
#include <iostream>
using namespace transport;
void check(bool ok){if(!ok){std::cerr<<"library invariant failed\n";std::abort();}}
int main(){
    check(versionLabel(5) == "build 5");
    check(versionLabel(9000) == "v0.9.0");
    check(versionLabel(1012003) == "v1.12.3");
    Library s;
    const unsigned capacity=s.freeBytes();
    for(unsigned i=0;i<210;i++){
        auto e=s.allocate(4090);check(e.start==i&&e.pages==1);
        s.items.push_back({e,{},false});
    }
    Library boot;check(boot.decode(s.encode()));check(boot.items.size()==210);
    check(boot.freeBytes()==capacity-210*sectorBytes);
    boot.selected=4;auto next=boot.allocate(6000);
    *boot.at(4)={next,{4,1},true};boot.selected=next.start;boot.pending=next.start;boot.attempted=true;
    Library retry;check(retry.decode(boot.encode()));retry.reject();
    check(retry.selected==4&&retry.freeBytes()==s.freeBytes());
    boot.confirm();check(boot.selected==next.start&&boot.freeBytes()==s.freeBytes()-sectorBytes);
    boot.remove(boot.selected);check(boot.selected==none&&boot.freeBytes()==s.freeBytes()+sectorBytes);
    check(boot.allocate(1).start==4);
    s={};for(unsigned b=0;b<bankCount;b++)s.items.push_back({{uint16_t(b*bankSectors),bankSectors},{},false});
    check(s.freeBytes()==0&&!s.allocate(1).pages);
    s.remove(bankSectors);check(s.allocate(bankSectors*sectorBytes).start==bankSectors);
    check(!s.allocate(bankSectors*sectorBytes+1).pages);
    auto invalid=s.encode();invalid[5]=bankSectors+1;check(!boot.decode(invalid));
    invalid=s.encode();invalid[9]=0;check(!boot.decode(invalid));
    s={};s.items={{{0,1},{},false},{{1,2},{},true}};s.selected=0;s.pending=1;s.reject();
    check(s.items.size()==1&&s.selected==0);
}
