import React, { Component, PropTypes } from 'react'
import { Sidebar, Menu } from 'semantic-ui-react'

export default class EditorSidebar extends Component {
  _renderMenuItem () {
    const { toc } = this.props
    return toc.map((item, index) => {
      const title = `${item['tocnumber']} ${item['title']}`

      return (
        <Menu.Item name={ title } className={ `c-sidebar__menu-item--level-${item['toclevel']}` } key= { index }/>
      )
    })
  }

  render () {
    console.log(this.props.toc)
    return (
      <Sidebar
        as={Menu}
        animation="slide along"
        width="thin"
        visible={false}
        icon="labeled"
        vertical
        inverted
        className="c-sidebar"
      >
        { this._renderMenuItem() }
      </Sidebar>
    )
  }
}

EditorSidebar.propTypes = {
  toc: PropTypes.array.isRequired,
}
