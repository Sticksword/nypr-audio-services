import Component from '@ember/component';
import layout from '../../templates/components/nypr-player-integration/track-info';
import diffAttrs from 'ember-diff-attrs';
import { htmlSafe } from '@ember/template';
import { computed } from '@ember/object';

export default Component.extend({
  layout,
  tagName: '',

  showTitle: null,
  unescapedShowTitle: computed('showTitle', function() {
    return htmlSafe(this.showTitle);
  }),
  showUrl: null,

  storyTitle: null,
  unescapedStoryTitle: computed('storyTitle', function() {
    return htmlSafe(this.storyTitle);
  }),
  storyUrl: null,

  audioId: null,
  songDetails: null,

  didReceiveAttrs: diffAttrs('showTitle', function(changedAttrs, ...args) {
    this._super(...args);
    let isInitialRender = changedAttrs === null;
    let isBumper = this.get('currentSound.metadata.playContext') === 'audio-bumper';

    let showTitleChanged = changedAttrs
      && changedAttrs.showTitle
      && changedAttrs.showTitle[0] !== changedAttrs.showTitle[1];

    if (this.currentAudio && isInitialRender || showTitleChanged && !isBumper) {
     if (this.titleDidChange) {
       this.titleDidChange();
     }
    }
  })
});
