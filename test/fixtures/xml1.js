export default `
<MPD xmlns="urn:mpeg:DASH:schema:MPD:2011" xmlns:ytdrm="http://youtube.com/ytdrm" mediaPresentationDuration="PT0H3M1.63S" minBufferTime="PT1.5S" profiles="urn:mpeg:dash:profile:isoff-on-demand:2011"
type="static">
  <Period duration="PT0H3M1.63S" start="PT0S">
    <AdaptationSet>
      <ContentComponent contentType="video" id="1" />
      <ContentProtection schemeIdUri="com.youtube.clearkey">
        <ytdrm:License keyid="60061e017e477e877e57d00d1ed00d1e" key="1a8a2095e4deb2d29ec816ac7bae2082"/>
      </ContentProtection>
      <Representation bandwidth="4190760" codecs="avc1.640028" height="1080" id="1" mimeType="video/mp4" width="1920">
        <BaseURL>car_cenc-20120827-89.mp4</BaseURL>
        <SegmentBase indexRange="2755-3230">
          <Initialization range="0-2754" />
        </SegmentBase>
      </Representation>
      <Representation bandwidth="2073921" codecs="avc1.4d401f" height="720" id="2" mimeType="video/mp4" width="1280">
        <BaseURL>car_cenc-20120827-88.mp4</BaseURL>
        <SegmentBase indexRange="2789-3264">
          <Initialization range="0-2788" />
        </SegmentBase>
      </Representation>
    </AdaptationSet>
    <AdaptationSet>
      <ContentComponent contentType="audio" id="2" />
      <ContentProtection schemeIdUri="com.youtube.clearkey">
        <ytdrm:License keyid="60061e017e477e877e57d00d1ed00d1e" key="1a8a2095e4deb2d29ec816ac7bae2082"/>
      </ContentProtection>
      <Representation bandwidth="127236" codecs="mp4a.40.02" id="6" mimeType="audio/mp4" numChannels="2" sampleRate="44100">
        <BaseURL>car_cenc-20120827-8c.mp4</BaseURL>
        <SegmentBase indexRange="2673-2932">
          <Initialization range="0-2672" />
        </SegmentBase>
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>
`