import Component from '@ember/component';
import { readOnly } from '@ember/object/computed';
import { computed, get } from '@ember/object';
import { htmlSafe } from '@ember/template';
import layout from '../templates/components/queue-listitem';

export default Component.extend({
  layout,
  attributeBindings:  ['data-id'],
  'data-id':          readOnly('dataId'),
  state:              computed('isCurrent', 'playState', function() {
    return this.isCurrent ? this.playState : null;
  }),
  unescapedTitle: computed('story.title', function() {
    return htmlSafe(get(this, 'story.title'));
  }),
  unescapedShowTitle: computed('story.showTitle', function() {
    return htmlSafe(get(this, 'story.showTitle'));
  }),
});
