"""Read the public BODS ZIP from stdin and emit just the requested SCCU observations."""
import io
import json
import sys
import xml.etree.ElementTree as ET
from zipfile import ZipFile

ns = '{http://www.siri.org.uk/siri}'
lines = {'505', '555', '599', '516', '508'}
rows, updated = [], None
with ZipFile(io.BytesIO(sys.stdin.buffer.read())) as archive:
    if archive.getinfo('siri.xml').file_size > 150_000_000:
        raise ValueError('Unexpected BODS archive size')
    with archive.open('siri.xml') as xml:
        for _, el in ET.iterparse(xml, events=('end',)):
            if el.tag == ns + 'ResponseTimestamp' and updated is None:
                updated = el.text
            if el.tag != ns + 'VehicleActivity':
                continue
            journey = el.find(ns + 'MonitoredVehicleJourney')
            if journey is not None and journey.findtext(ns+'OperatorRef') == 'SCCU':
                line = journey.findtext(ns+'PublishedLineName') or journey.findtext(ns+'LineRef')
                if line in lines and journey.findtext(ns+'Monitored') != 'false':
                    vehicle = journey.findtext(ns+'VehicleRef')
                    loc = journey.find(ns+'VehicleLocation')
                    if loc is not None and vehicle:
                        rows.append({'id': vehicle, 'route': line, 'lon': loc.findtext(ns+'Longitude'),
                                     'lat': loc.findtext(ns+'Latitude'), 'time': el.findtext(ns+'RecordedAtTime'),
                                     'destination': journey.findtext(ns+'DestinationName')})
            el.clear()
if updated is None:
    raise ValueError('Missing SIRI delivery timestamp')
json.dump({'updated': updated, 'rows': rows}, sys.stdout)
